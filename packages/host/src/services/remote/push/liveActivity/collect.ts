/**
 * Reads the agents a Live Activity shows out of the host's state, and keeps
 * the ones that just finished around for a while so a glance still finds them.
 */

import type { ActivityAgent, ActivityPhase, ActivityPrompt } from "./state";
import path from "node:path";
import { appState } from "../../../../state";
import { liveConversation } from "../../../agent/conversation/live";
import { OUTCOME_LINGER_MS, stepSummary } from "./state";

const AWAITS_ANSWER = new Set(["AskUserQuestion", "ExitPlanMode"]);

/** Agents that stopped working, kept until they age off the activity. */
const outcomes = new Map<string, ActivityAgent>();
/** The last description of every agent seen working, for when it is gone. */
const lastSeen = new Map<string, ActivityAgent>();

function projectOf(sessionId: string): string | null {
  const session = appState.sessions.get(sessionId);
  if (!session) {
    return null;
  }
  if (session.kind === "scratch_pad") {
    return session.display_name ?? null;
  }

  return session.repo_root ? path.basename(session.repo_root) : null;
}

/** The first permission prompt Approve/Deny can answer. */
function promptOf(agentId: string): ActivityPrompt | null {
  const pending = appState.agentPendingPermissions.get(agentId);
  for (const request of pending?.values() ?? []) {
    if (!AWAITS_ANSWER.has(request.tool_name)) {
      return {
        toolUseId: request.tool_use_id,
        summary: stepSummary(request.tool_name, request.tool_input),
      };
    }
  }

  return null;
}

interface Transcript {
  step: string | null;
  /** A question or plan nobody answered yet. */
  awaitingAnswer: boolean;
}

function readTranscript(agentId: string): Transcript {
  const messages = liveConversation(agentId)?.messages ?? [];
  for (
    let i = messages.length - 1;
    i >= Math.max(0, messages.length - 4);
    i--
  ) {
    const calls = messages[i]?.toolCalls ?? [];
    const last = calls[calls.length - 1];
    if (last) {
      return {
        step: stepSummary(last.name, last.input),
        awaitingAnswer: AWAITS_ANSWER.has(last.name) && last.result == null,
      };
    }
  }

  return { step: null, awaitingAnswer: false };
}

/** The agent as the activity shows it, or null while it is just sitting idle. */
export function describeAgent(agentId: string): ActivityAgent | null {
  const agent = appState.agents.get(agentId);
  if (!agent) {
    return null;
  }
  const prompt = promptOf(agentId);
  const transcript = readTranscript(agentId);
  let state: ActivityPhase | null = null;
  if (
    prompt ||
    agent.status === "requires_action" ||
    transcript.awaitingAnswer ||
    appState.agentPendingPermissions.get(agentId)?.size
  ) {
    state = "needsYou";
  } else if (agent.status === "running" || agent.inflightPrompts > 0) {
    state = "working";
  }
  if (!state) {
    return null;
  }
  const title = liveConversation(agentId)?.title?.trim();
  const described: ActivityAgent = {
    id: agentId,
    sessionId: agent.sessionId,
    title: title || "Agent",
    project: projectOf(agent.sessionId),
    state,
    startedAt: agent.createdAt,
    endedAt: null,
    step: transcript.step,
    prompt,
  };
  lastSeen.set(agentId, described);
  outcomes.delete(agentId);

  return described;
}

/**
 * An agent's status changed. One that was working and now isn't becomes an
 * outcome — failed on an error, done otherwise.
 */
export function recordStatus(
  agentId: string,
  status: string,
  now: number,
): void {
  // The CLI can flip to idle between tool calls; a prompt in flight is still work.
  const ended = status === "error" || status === "stopped";
  if (!ended && describeAgent(agentId)) {
    return;
  }
  const before = lastSeen.get(agentId);
  lastSeen.delete(agentId);
  if (!before) {
    return;
  }
  outcomes.set(agentId, {
    ...before,
    state: status === "error" ? "failed" : "done",
    endedAt: now,
    prompt: null,
  });
}

/** Every agent the activity should consider right now. */
export function collectAgents(now: number): ActivityAgent[] {
  const live: ActivityAgent[] = [];
  for (const agentId of appState.agents.keys()) {
    const described = describeAgent(agentId);
    if (described) {
      live.push(described);
    }
  }
  for (const [agentId, outcome] of outcomes) {
    if (now - (outcome.endedAt ?? now) >= OUTCOME_LINGER_MS) {
      outcomes.delete(agentId);
    }
  }
  const liveIds = new Set(live.map((a) => a.id));

  return [...live, ...[...outcomes.values()].filter((o) => !liveIds.has(o.id))];
}

export function resetCollected(): void {
  outcomes.clear();
  lastSeen.clear();
}
