/**
 * Executing one automation run.
 *
 * Creates the neutral host session, starts an agent in it, hands it the
 * playbook, waits for the turn to finish and records the result. A `propose`
 * run stays in `plan` mode so the CLI itself refuses edits; higher rungs are
 * held by the MCP gate instead. The agent's final message is the report.
 */

import type { Automation, AutomationRun, AutonomyLevel } from "./models";
import type { GatheredSignals } from "../signals/registry";
import { emitHostEvent } from "@argus/host/bus";
import { error, info } from "@argus/host/logger";
import { appState } from "../../state";
import {
  sendAgentMessage,
  startAgent,
  stopAgent,
  waitForAgent,
} from "../agent/agentService";
import { ensureRepoRegistered } from "../mcp/projects";
import { gatherSignals, serializeWorkItems } from "../signals/registry";
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
import { calibrationBlock } from "./outcomes";
import { dailyBudgetBlock, runBudgetBlock, runSpendUsd } from "./spend";

/**
 * How long a run may take before it is abandoned. Nobody is watching an
 * automation, so an agent that stalls on a prompt must not hold its schedule
 * hostage forever.
 */
const RUN_TIMEOUT_MS = 20 * 60 * 1000;

/** How often a run's spend is compared against its ceiling. */
const COST_POLL_MS = 15 * 1000;

/**
 * A `propose` run never leaves plan mode, so the CLI itself blocks every
 * write. Higher rungs need to act, and are held by the MCP gate instead.
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
    error(`automation run ${runId} failed: ${message}`);
    finish(runId, "failed", { error: message });
  });
}

function finish(
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

async function execute(automation: Automation, runId: string): Promise<void> {
  for (const repoRoot of automation.scope.repo_roots) {
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
    repoRoots: automation.scope.repo_roots,
  });

  const session = createAutomationHostSession({
    automationId: automation.id,
    runId,
    displayName: automation.name,
  });
  updateRun(runId, { host_session_id: session.id });

  const autonomy = resolveHostAutonomy(automation);
  const guardrails = normalizeGuardrails(automation.guardrails);
  const permissionMode = permissionModeFor(autonomy);

  const agentInfo = await startAgent(
    session.id,
    automation.model ?? undefined,
    permissionMode,
  );
  updateRun(runId, { host_agent_id: agentInfo.agent_id });

  const prompt = buildPrompt(automation, signals, autonomy);

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

  sendAgentMessage(agentInfo.agent_id, prompt);

  const costWatch = watchRunCost(runId, guardrails.max_cost_usd_per_run, () =>
    stopAgentQuietly(agentInfo.agent_id),
  );

  let outcome: Awaited<ReturnType<typeof waitForAgent>>;
  try {
    outcome = await waitForAgent(agentInfo.agent_id, RUN_TIMEOUT_MS);
  } catch (e) {
    clearInterval(costWatch);
    await stopAgentQuietly(agentInfo.agent_id);
    finish(runId, "failed", {
      error: typeof e === "string" ? e : String(e),
      cost_usd: runSpendUsd(runId),
    });

    return;
  }
  clearInterval(costWatch);

  const spent = runSpendUsd(runId);
  const overRunBudget = runBudgetBlock(runId, guardrails.max_cost_usd_per_run);
  if (overRunBudget) {
    await stopAgentQuietly(agentInfo.agent_id);
    finish(runId, "failed", {
      cost_usd: spent,
      report_markdown: outcome.result?.result ?? null,
      error: `Stopped — ${overRunBudget}.`,
    });

    return;
  }

  const result = outcome.result;
  const failed = outcome.status === "error" || result?.subtype === "error";
  finish(runId, failed ? "failed" : "succeeded", {
    cost_usd: spent || (result?.total_cost_usd ?? null),
    report_markdown: result?.result ?? null,
    error: failed
      ? (result?.result ?? "The run's agent exited with an error.")
      : null,
  });

  await stopAgentQuietly(agentInfo.agent_id);
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

async function stopAgentQuietly(agentId: string): Promise<void> {
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

function buildPrompt(
  automation: Automation,
  signals: GatheredSignals,
  autonomy: AutonomyLevel,
): string {
  const scopeLines =
    automation.scope.repo_roots.length > 0
      ? automation.scope.repo_roots.map((r) => `- \`${r}\``).join("\n")
      : "- (no projects configured — say so in the report rather than guessing)";

  return [
    automation.playbook.trim(),
    "",
    "---",
    "",
    "## Run context",
    "",
    `This is an automated run of **${automation.name}**, started at ${new Date().toISOString()}. Nobody is watching it.`,
    "",
    "Projects in scope:",
    "",
    scopeLines,
    "",
    "You are in a neutral working directory that is not a checkout of any of them. Read the projects at their absolute paths; never write to them.",
    ...autonomySection(automation, autonomy),
    ...signalSections(automation, signals),
    ...(calibrationBlock(automation.id)?.split("\n") ?? []),
    "",
    "## Output",
    "",
    "Call `emit_report` with the report as blocks — stats, tables, lists, a series — and keep your final assistant message to a one-line summary. Blocks render as a dashboard; a final message only renders as text, so reach for markdown blocks only for the prose parts.",
    "",
    "Whatever you write, no preamble, no offer to do more, no request for approval. If `emit_report` is not available to you, write the report as your final message in markdown instead.",
  ].join("\n");
}

/**
 * What this run may do, stated plainly. The statement is a courtesy — the
 * limits are enforced in Node on every tool call, so a playbook that tells the
 * agent otherwise changes only how much of its turn it wastes.
 */
function autonomySection(
  automation: Automation,
  autonomy: AutonomyLevel,
): string[] {
  const guardrails = normalizeGuardrails(automation.guardrails);
  const allowed = {
    propose:
      "You may only emit proposals. Any attempt to create a session, spawn an agent or merge anything will be refused.",
    draft:
      "You may start sessions for proposals that clear the guardrails, and those sessions may implement and commit. Pushing and merging will be refused.",
    pr: "You may start sessions and, once a branch is ready, call `open_session_pr`. Merging will be refused.",
    auto_merge:
      "You may start sessions, open pull requests, and merge them once CI is green.",
  }[autonomy];

  return [
    "",
    "## Autonomy",
    "",
    `This run's autonomy is **${autonomy}**. ${allowed}`,
    "",
    `Guardrails: confidence threshold ${guardrails.confidence_threshold}, at most ${guardrails.max_concurrent_sessions} session(s) in flight, at most ${guardrails.max_files_changed} files changed per branch${guardrails.path_denylist.length > 0 ? `, never touching ${guardrails.path_denylist.join(", ")}` : ""}.`,
    "",
    "These are enforced in Argus itself, not by you. Do not try to work around them; report what you could not do instead.",
  ];
}

/**
 * The signals half of the prompt: what Node already fetched, plus whatever the
 * agent-mode sources want the agent to fetch for itself.
 */
function signalSections(
  automation: Automation,
  signals: GatheredSignals,
): string[] {
  if (automation.source_ids.length === 0) {
    return [];
  }

  const lines = [
    "",
    "## Work items",
    "",
    signals.instructions.length > 0
      ? "These were fetched for you. The sections below name the sources you fetch yourself; beyond those two, do not go looking for more."
      : "These were fetched for you. Do not go looking for more.",
    "",
    "```json",
    serializeWorkItems(signals.items, {
      agentSources: signals.instructions.length > 0,
    }),
    "```",
  ];

  for (const instructions of signals.instructions) {
    lines.push("", instructions);
  }

  if (signals.unavailable.length > 0) {
    lines.push(
      "",
      `Unavailable sources: ${signals.unavailable.join(", ")}. Note this in the report; do not treat it as "there is no work".`,
    );
  }

  return lines;
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
  finish(runId, "cancelled", { error: null });

  return getAutomationRun(runId) ?? run;
}
