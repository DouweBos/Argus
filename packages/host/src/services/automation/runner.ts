/**
 * Executing one automation run.
 *
 * Creates the neutral host session, starts an agent in it, hands it the
 * playbook, waits for the turn to finish and records the result. P1 is
 * report-only: the agent runs in `plan` mode so the CLI itself refuses edits,
 * and its final message is the report.
 */

import type { Automation, AutomationRun } from "./models";
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
import { createAutomationHostSession } from "./hostSession";
import {
  createRun,
  getAutomationRun,
  hasActiveRun,
  markAutomationFired,
  requireAutomation,
  updateRun,
} from "./manager";

/**
 * How long a run may take before it is abandoned. Nobody is watching an
 * automation, so an agent that stalls on a prompt must not hold its schedule
 * hostage forever.
 */
const RUN_TIMEOUT_MS = 20 * 60 * 1000;

/** Report-only runs never leave plan mode, so the CLI blocks every write. */
const RUN_PERMISSION_MODE = "plan";

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

  const run = createRun(automationId, "running", triggerReason);
  markAutomationFired(automationId, run.started_at);

  execute({ ...automation }, run.id).catch((e: unknown) => {
    const message = typeof e === "string" ? e : String(e);
    error(`automation run ${run.id} failed: ${message}`);
    finish(run.id, "failed", { error: message });
  });

  return run;
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

  const agentInfo = await startAgent(
    session.id,
    automation.model ?? undefined,
    RUN_PERMISSION_MODE,
  );
  updateRun(runId, { host_agent_id: agentInfo.agent_id });

  const prompt = buildPrompt(automation, signals);

  // Without this the renderer never registers the agent or subscribes to its
  // event channels, and the session view falls back to the "Start agent"
  // panel — a backend-initiated spawn is invisible to the UI otherwise.
  emitHostEvent("agent:started", {
    agent_id: agentInfo.agent_id,
    session_id: agentInfo.session_id,
    status: agentInfo.status,
    permission_mode: RUN_PERMISSION_MODE,
    parent_agent_id: agentInfo.parent_agent_id,
    created_at: agentInfo.created_at,
    initial_prompt: prompt,
    model: agentInfo.model,
  });

  sendAgentMessage(agentInfo.agent_id, prompt);

  let outcome: Awaited<ReturnType<typeof waitForAgent>>;
  try {
    outcome = await waitForAgent(agentInfo.agent_id, RUN_TIMEOUT_MS);
  } catch (e) {
    await stopAgentQuietly(agentInfo.agent_id);
    finish(runId, "failed", {
      error: typeof e === "string" ? e : String(e),
    });

    return;
  }

  const result = outcome.result;
  const failed = outcome.status === "error" || result?.subtype === "error";
  finish(runId, failed ? "failed" : "succeeded", {
    cost_usd: result?.total_cost_usd ?? null,
    report_markdown: result?.result ?? null,
    error: failed
      ? (result?.result ?? "The run's agent exited with an error.")
      : null,
  });

  await stopAgentQuietly(agentInfo.agent_id);
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

function buildPrompt(automation: Automation, signals: GatheredSignals): string {
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
    ...signalSections(automation, signals),
    "",
    "## Output",
    "",
    "Your final assistant message is the report. Write it as markdown — no preamble, no offer to do more, no request for approval.",
  ].join("\n");
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
    "These were fetched for you. Do not go looking for more.",
    "",
    "```json",
    serializeWorkItems(signals.items),
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
