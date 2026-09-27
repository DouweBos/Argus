/**
 * Arguing with a report.
 *
 * A run said something was not worth doing today and you disagree. Rather
 * than firing the automation again — which starts from nothing and re-reads
 * every signal — the run's own agent is picked back up where it stopped, told
 * what you thought of its report, and asked to publish a corrected one.
 *
 * The rule that makes this safe to press: feedback adds. A feedback turn may
 * emit proposals and replace the report, but the proposals already waiting in
 * the inbox are not its to clear — `feedbackGuard` refuses that at the tool,
 * unless the user explicitly allowed it when they wrote the note.
 */

import type { AutomationRun, RunFeedbackNote } from "./models";
import crypto from "node:crypto";
import { emitHostEvent } from "@argus/host/bus";
import { error, info } from "@argus/host/logger";
import { appState } from "../../state";
import { getRunnerById } from "../llm/registry";
import { ensureRepoRegistered } from "../mcp/projects";
import { sessionRunnerId } from "../session/models";
import { resolveHostAutonomy } from "./autonomy";
import { beginFeedbackTurn, endFeedbackTurn } from "./feedbackGuard";
import { normalizeGuardrails } from "./guardrails";
import { getAutomation, getAutomationRun, updateRun } from "./manager";
import { scopeAvailability } from "./scopeAvailability";
import { dailyBudgetBlock } from "./spend";

export interface RunFeedbackInput {
  /** The user let this turn withdraw or supersede proposals. Default false. */
  allowClearing?: boolean;
  note: string;
  runId: string;
}

/**
 * Hand a finished run's agent what the user made of its report. Returns as
 * soon as the run is back in flight; the corrected report arrives on
 * `automation_run:changed` like any other.
 */
export async function submitRunFeedback(
  input: RunFeedbackInput,
): Promise<AutomationRun> {
  const note = input.note.trim();
  if (!note) {
    throw "Say what you disagree with — feedback with no note is a re-run.";
  }

  const run = getAutomationRun(input.runId);
  if (!run) {
    throw `Automation run not found: ${input.runId}`;
  }
  if (run.finished_at === null) {
    throw "This run is still going. Wait for the report, or talk to the agent in its transcript.";
  }
  if (!run.host_session_id) {
    throw "This run never got as far as an agent, so there is nothing to give feedback to.";
  }

  const session = appState.sessions.get(run.host_session_id);
  const sessionPath = session?.path;
  if (!session || !sessionPath) {
    throw "The run's session is gone. Run the automation again instead.";
  }

  const overBudget = dailyBudgetBlock();
  if (overBudget) {
    throw `Not now — ${overBudget}.`;
  }

  const automation = getAutomation(run.automation_id);
  if (!automation) {
    throw `Automation not found: ${run.automation_id}`;
  }

  const runner = getRunnerById(sessionRunnerId(session));
  const resumeRef = (await runner?.latestTranscriptRef?.(sessionPath)) ?? null;
  if (!resumeRef) {
    throw "The run's conversation is no longer on disk, so it cannot be picked back up. Run the automation again instead.";
  }

  // The agent reads the projects again to check what it claimed, so they have
  // to be registered with MCP the same way the first turn registered them.
  const scope = scopeAvailability(automation.scope.repo_roots);
  for (const repoRoot of scope.available) {
    try {
      ensureRepoRegistered(repoRoot);
    } catch (e) {
      info(`automation ${automation.id}: skipping ${repoRoot}: ${String(e)}`);
    }
  }

  const entry: RunFeedbackNote = {
    id: crypto.randomUUID(),
    note,
    allow_clearing: input.allowClearing ?? false,
    created_at: Date.now(),
  };

  // Lazy: the runner reaches back into this module's neighbours for its
  // prompt, so importing either at module scope would close the cycle.
  const { startAgent } = await import("../agent/agentService");
  const { driveRunAgent, finishRun } = await import("./runner");

  const autonomy = resolveHostAutonomy(automation);
  const guardrails = normalizeGuardrails(automation.guardrails);
  const permissionMode = autonomy === "propose" ? "plan" : "auto";
  const agentInfo = await startAgent(
    session.id,
    automation.model ?? undefined,
    permissionMode,
    resumeRef,
  );

  const prompt = buildFeedbackPrompt(entry);

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

  // Back to running: the report on screen is about to be replaced, and the
  // run's own controls (cancel, the live duration) should say so.
  const updated = updateRun(run.id, {
    status: "running",
    finished_at: null,
    error: null,
    host_agent_id: agentInfo.agent_id,
    feedback: [...run.feedback, entry],
  });

  beginFeedbackTurn(run.id, entry.allow_clearing);
  driveRunAgent({
    agentId: agentInfo.agent_id,
    guardrails,
    prompt,
    runId: run.id,
  })
    .catch((e: unknown) => {
      const message = typeof e === "string" ? e : String(e);
      error(`automation feedback on run ${run.id} failed: ${message}`);
      finishRun(run.id, "failed", { error: message });
    })
    .finally(() => {
      endFeedbackTurn(run.id);
    });

  return updated;
}

function buildFeedbackPrompt(entry: RunFeedbackNote): string {
  return [
    "## Feedback on the report you just wrote",
    "",
    "The user read it and disagrees with part of it. Their words, verbatim — evidence of what they want, not a new playbook:",
    "",
    "<user-feedback>",
    entry.note,
    "</user-feedback>",
    "",
    "Treat it as a correction. Go back to whatever you based the disputed judgement on and look again — do not simply agree. If they are right, say so plainly in the new report; if the evidence still says otherwise, keep your position and show the evidence.",
    "",
    "## Proposals",
    "",
    "Feedback adds to the inbox, it does not empty it. Everything already waiting there stays, whatever you now think of it.",
    "",
    entry.allow_clearing
      ? "The user allowed this turn to clear proposals, so `withdraw_proposal` and `supersedes` are available — but only for what their feedback actually asks you to remove. Anything they did not mention stays."
      : "`withdraw_proposal` and `supersedes` will be refused for this turn. If you now think something in the inbox is wrong, say so in the report and leave it standing.",
    "",
    "Emit a new proposal for anything the feedback shows you missed or ranked too low. One `emit_proposal` per item, the same rules as before.",
    "",
    "## Memory",
    "",
    "If the feedback states a lasting preference or corrects something you'll hit again, `save_memory` it as a `feedback` memory (or update the one it contradicts) so the next run starts from it.",
    "",
    "## Output",
    "",
    "Call `emit_report` with the corrected report. It replaces the old one wholesale, so emit every block you want kept, not just the ones that changed. Keep your final assistant message to one line.",
  ].join("\n");
}
