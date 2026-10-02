/**
 * Executing one automation run.
 *
 * Creates the neutral host session, starts an agent in it, hands it the
 * playbook, waits for the turn to finish and records the result. A `propose`
 * run is held read-only by plan mode plus a pre-hook that answers every
 * request; higher rungs run in `auto` and are held by the ladder. The agent's
 * final message is the report.
 */

import type {
  Automation,
  AutomationGuardrails,
  AutomationRun,
  AutonomyLevel,
} from "./models";
import { emitHostEvent } from "@argus/host/bus";
import { error, info } from "@argus/host/logger";
import { appState } from "../../state";
import {
  sendAgentMessage,
  startAgent,
  stopAgent,
  waitForAgent,
} from "../agent/agentService";
import {
  accountFallbackOrder,
  classifyRunFailure,
  resolveAccountForSession,
} from "../claudeAuth/accounts";
import { ensureRepoRegistered } from "../mcp/projects";
import { DEFAULT_RUNNER_ID } from "../session/models";
import { gatherSignals } from "../signals/registry";
import { resolveHostAutonomy } from "./autonomy";
import { normalizeGuardrails } from "./guardrails";
import { createAutomationHostSession } from "./hostSession";
import {
  createRun,
  getAutomationRun,
  hasActiveRun,
  markAutomationFired,
  requireAutomation,
  updateRun,
} from "./manager";
import { buildPrompt } from "./runPrompt";
import { scopeAvailability, scopeAvailabilityBlock } from "./scopeAvailability";
import { dailyBudgetBlock, runBudgetBlock, runSpendUsd } from "./spend";

/** How often a run's spend is compared against its ceiling. */
const COST_POLL_MS = 15 * 1000;

/**
 * How long a run may take before it is abandoned, from its `max_run_minutes`
 * guardrail. Nobody is watching an automation, so an agent that stalls on a
 * prompt must not hold its schedule hostage forever — but a triage playbook
 * reading a whole nightly CI run legitimately needs longer than the default.
 */
function runTimeoutMs(maxRunMinutes: number): number {
  return maxRunMinutes * 60 * 1000;
}

/**
 * A `propose` run goes back into plan mode, so the CLI refuses edits itself
 * rather than Argus trying to name every spelling of a write. What made that
 * hang before was not the mode but the silence: an unanswered prompt at 07:30
 * ran out the 20-minute clock. The pre-hook now answers every request a
 * read-only run makes — see `automationPermissionPreHook`. Higher rungs act by
 * definition, so they stay in `auto` and are held by the ladder instead.
 */
function permissionModeFor(autonomy: AutonomyLevel): "auto" | "plan" {
  return autonomy === "propose" ? "plan" : "auto";
}

/**
 * Fire an automation. Returns as soon as the run record exists — the session
 * and agent come up asynchronously and progress is published on
 * `automation_run:changed`.
 */
export function startAutomationRun(
  automationId: string,
  triggerReason: string,
): AutomationRun {
  const automation = requireAutomation(automationId);

  if (hasActiveRun(automationId)) {
    return createRun(
      automationId,
      "skipped",
      triggerReason,
      "The previous run is still in progress.",
    );
  }

  // The budget is a limit, not a report: a run that would exceed it does not
  // happen at all.
  const overBudget = dailyBudgetBlock();
  if (overBudget) {
    return createRun(
      automationId,
      "skipped",
      triggerReason,
      `Skipped — ${overBudget}.`,
    );
  }

  // Nothing in scope is readable — usually an external drive that isn't
  // plugged in. A report written from no evidence is worse than no report.
  const unreachable = scopeAvailabilityBlock(automation.scope.repo_roots);
  if (unreachable) {
    return createRun(
      automationId,
      "skipped",
      triggerReason,
      `Skipped — ${unreachable}.`,
    );
  }

  const run = createRun(automationId, "running", triggerReason);
  markAutomationFired(automationId, run.started_at);
  executeRun({ ...automation }, run.id);

  return run;
}

/**
 * Drive one run to completion in the background. The same path for a scheduled
 * run and an ad-hoc one — an ad-hoc run differs only in that its `Automation`
 * is synthetic, never in how it is executed or what it is held to.
 */
export function executeRun(automation: Automation, runId: string): void {
  execute(automation, runId).catch((e: unknown) => {
    const message = typeof e === "string" ? e : String(e);
    // The run record shows the message; the log gets the stack, because a
    // crash here happens unattended and there is nothing else to go on.
    error(
      `automation run ${runId} failed: ${e instanceof Error ? (e.stack ?? message) : message}`,
    );
    finishRun(runId, "failed", { error: message });
  });
}

async function execute(automation: Automation, runId: string): Promise<void> {
  // A project whose drive is out is dropped from the run rather than failing
  // it: the other projects in scope are still worth looking at, and the agent
  // is told which ones it could not see.
  const scope = scopeAvailability(automation.scope.repo_roots);
  for (const skipped of scope.unavailable) {
    info(
      `automation ${automation.id}: ${skipped.repo_root} is on ${skipped.volume}, which isn't connected`,
    );
  }

  for (const repoRoot of scope.available) {
    try {
      ensureRepoRegistered(repoRoot);
    } catch (e) {
      info(`automation ${automation.id}: skipping ${repoRoot}: ${String(e)}`);
    }
  }

  // Native sources are fetched here and serialized into the prompt; agent-mode
  // sources hand the agent instructions and let it do the fetching itself.
  const signals = await gatherSignals({
    sourceIds: automation.source_ids,
    repoRoots: scope.available,
  });

  const session = createAutomationHostSession({
    automationId: automation.id,
    runId,
    displayName: automation.name,
    runner: automation.runner,
    model: automation.model,
  });
  updateRun(runId, { host_session_id: session.id });

  const autonomy = resolveHostAutonomy(automation);
  const guardrails = normalizeGuardrails(automation.guardrails);
  const permissionMode = permissionModeFor(autonomy);
  const prompt = buildPrompt(automation, signals, autonomy, scope);

  // A spent plan limit on one Claude account says nothing about the others, so
  // the run moves on to the next one before giving up, unless opted out.
  // Custom runners bring their own credentials.
  const accounts: (string | null)[] =
    guardrails.retry_other_accounts && session.runner_id === DEFAULT_RUNNER_ID
      ? accountFallbackOrder(resolveAccountForSession(session))
      : [null];

  for (const [attempt, accountId] of accounts.entries()) {
    const live = appState.sessions.get(session.id);
    if (accountId && live) {
      live.claude_account_id = accountId;
    }

    const agentInfo = await startAgent(
      session.id,
      automation.model ?? undefined,
      permissionMode,
    );
    updateRun(runId, { host_agent_id: agentInfo.agent_id });

    // Without this the renderer never registers the agent or subscribes to its
    // event channels, and the session view falls back to the "Start agent"
    // panel — a backend-initiated spawn is invisible to the UI otherwise.
    emitHostEvent("agent:started", {
      agent_id: agentInfo.agent_id,
      session_id: agentInfo.session_id,
      status: agentInfo.status,
      permission_mode: permissionMode,
      parent_agent_id: agentInfo.parent_agent_id,
      created_at: agentInfo.created_at,
      initial_prompt: prompt,
      model: agentInfo.model,
    });

    const settled = await driveRunAgent({
      agentId: agentInfo.agent_id,
      guardrails,
      prompt,
      runId,
      retryOnRateLimit: attempt < accounts.length - 1,
    });
    if (settled !== "rate_limited") {
      return;
    }
    info(
      `automation run ${runId}: account ${accountId} hit its plan limit, retrying on ${accounts[attempt + 1]}`,
    );
  }
}

export function finishRun(
  runId: string,
  status: AutomationRun["status"],
  patch: Partial<AutomationRun> = {},
): void {
  const existing = getAutomationRun(runId);
  if (!existing || existing.finished_at !== null) {
    return;
  }
  updateRun(runId, { status, finished_at: Date.now(), ...patch });
}

/**
 * Poll the run's spend while its agent works. The ceiling has to be enforced
 * mid-flight: a fan-out's cost is only knowable as its children finish, and by
 * the time the host's own turn ends the money is gone.
 */
function watchRunCost(
  runId: string,
  maxCostUsdPerRun: number,
  stop: () => Promise<void>,
): NodeJS.Timeout {
  const timer = setInterval(() => {
    if (!runBudgetBlock(runId, maxCostUsdPerRun)) {
      return;
    }
    clearInterval(timer);
    info(`automation run ${runId}: cost ceiling reached, stopping the agent`);
    stop().catch(() => {});
  }, COST_POLL_MS);

  return timer;
}

export async function stopAgentQuietly(agentId: string): Promise<void> {
  const agent = appState.agents.get(agentId);
  if (!agent || agent.status === "stopped" || agent.status === "error") {
    return;
  }
  try {
    await stopAgent(agentId);
  } catch (e) {
    info(`automation: stopping agent ${agentId} failed: ${String(e)}`);
  }
}

/**
 * Send one prompt to the run's agent, wait it out, and settle the run record.
 * Shared with the feedback turn, which picks the same agent back up on a run
 * that already finished once. Always leaves the agent stopped.
 */
export async function driveRunAgent(args: {
  agentId: string;
  guardrails: AutomationGuardrails;
  prompt: string;
  runId: string;
  /** Leave the run open when the account's plan limit is spent. */
  retryOnRateLimit?: boolean;
}): Promise<"rate_limited" | "settled"> {
  const { agentId, guardrails, prompt, runId } = args;

  sendAgentMessage(agentId, prompt);
  // The renderer only draws user bubbles for sends it made itself.
  emitHostEvent(`agent:remote-message:${agentId}`, {
    message: prompt,
    author: "Automation",
  });

  const costWatch = watchRunCost(runId, guardrails.max_cost_usd_per_run, () =>
    stopAgentQuietly(agentId),
  );

  let outcome: Awaited<ReturnType<typeof waitForAgent>>;
  try {
    outcome = await waitForAgent(
      agentId,
      runTimeoutMs(guardrails.max_run_minutes),
    );
  } catch {
    clearInterval(costWatch);
    await stopAgentQuietly(agentId);
    // The agent id means nothing to whoever reads the run; the limit it hit,
    // and where to raise it, is the only actionable part.
    finishRun(runId, "failed", {
      error: `Stopped after ${guardrails.max_run_minutes} minutes — the run hit its time limit. Raise it in the automation's guardrails if this playbook needs longer.`,
      cost_usd: runSpendUsd(runId),
    });

    return "settled";
  }
  clearInterval(costWatch);

  const spent = runSpendUsd(runId);
  const overRunBudget = runBudgetBlock(runId, guardrails.max_cost_usd_per_run);
  if (overRunBudget) {
    await stopAgentQuietly(agentId);
    finishRun(runId, "failed", {
      cost_usd: spent,
      report_markdown: outcome.result?.result ?? null,
      error: `Stopped — ${overRunBudget}.`,
    });

    return "settled";
  }

  const result = outcome.result;
  const failed = outcome.status === "error" || result?.subtype === "error";
  if (
    failed &&
    args.retryOnRateLimit &&
    classifyRunFailure(result?.result ?? "") === "rate_limited"
  ) {
    await stopAgentQuietly(agentId);

    return "rate_limited";
  }
  finishRun(runId, failed ? "failed" : "succeeded", {
    cost_usd: spent || (result?.total_cost_usd ?? null),
    report_markdown: result?.result ?? null,
    error: failed
      ? (result?.result ?? "The run's agent exited with an error.")
      : null,
  });

  await stopAgentQuietly(agentId);

  return "settled";
}

/** Stop a run that is still in flight. */
export async function cancelAutomationRun(
  runId: string,
): Promise<AutomationRun> {
  const run = getAutomationRun(runId);
  if (!run) {
    throw `Automation run not found: ${runId}`;
  }
  if (run.finished_at !== null) {
    return run;
  }
  if (run.host_agent_id) {
    await stopAgentQuietly(run.host_agent_id);
  }
  finishRun(runId, "cancelled", { error: null });

  return getAutomationRun(runId) ?? run;
}
