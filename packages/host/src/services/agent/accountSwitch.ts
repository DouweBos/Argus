/**
 * The model picker's Claude account switch. The account is baked into the
 * subprocess env at spawn, so moving an agent means respawning it in place —
 * with `--resume` once it has a conversation, and only once it's idle.
 */

import type { AgentSession } from "./models";
import { emitHostEvent } from "@argus/host/bus";
import { warn } from "@argus/host/logger";
import { appState } from "../../state";
import {
  getClaudeAccount,
  resolveAccountForSession,
} from "../claudeAuth/accounts";
import { setSessionClaudeAccount } from "../session/sessionOps";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { respawnAgent, sendAgentMessage } from "./agentService";
import { liveConversation } from "./conversation/live";
import { handoffCandidates } from "./limitHandoff";
import {
  CONTINUE_MESSAGE,
  forgetLimitResume,
  isLimitStalled,
  limitResumeAt,
} from "./limitResume";
import { pinSessionAccount } from "./sessionAccountPin";

/** Which control asked for the move. */
export type AccountSwitchSource = "limit_card" | "picker";

interface QueuedSwitch {
  /** The pin to restore if the switch fails: the one before the first queued pick. */
  previousPin: string | null;
  /** The slot the idle waiter hangs on; a respawn by anything else drops it. */
  waitingOn: AgentSession;
  source: AccountSwitchSource;
}

/** Busy agents waiting to move. The session pin holds the target, so the latest pick wins. */
const queued = new Map<string, QueuedSwitch>();

export function isAgentBusy(agent: AgentSession): boolean {
  return (
    agent.status === "running" ||
    agent.status === "requires_action" ||
    agent.inflightPrompts > 0 ||
    (appState.agentPendingPermissions.get(agent.agentId)?.size ?? 0) > 0
  );
}

function isGone(agent: AgentSession | undefined): boolean {
  return !agent || agent.status === "stopped" || agent.status === "error";
}

function onAccount(agent: AgentSession): boolean {
  return (
    agent.accountId ===
    resolveAccountForSession(appState.sessions.get(agent.sessionId))
  );
}

function waitForIdle(agent: AgentSession, entry: QueuedSwitch): void {
  entry.waitingOn = agent;
  // Deferred: waiters are resolved inside a loop that clears the list after.
  agent.turnWaiters.push((status) =>
    queueMicrotask(() => {
      if (status === "idle") {
        applyQueued(agent.agentId);
      } else {
        queued.delete(agent.agentId);
      }
    }),
  );
}

function applyQueued(agentId: string): void {
  const entry = queued.get(agentId);
  const agent = appState.agents.get(agentId);
  if (!entry) {
    return;
  }
  if (!agent || isGone(agent) || onAccount(agent)) {
    queued.delete(agentId);

    return;
  }
  if (isAgentBusy(agent)) {
    // A queued message went out on the same idle.
    waitForIdle(agent, entry);

    return;
  }
  queued.delete(agentId);
  moveAgent(agent, entry.previousPin, true, entry.source).catch(
    (e: unknown) => {
      warn(`[agent:${agentId}] queued account switch failed: ${String(e)}`);
    },
  );
}

/**
 * Respawn on the session's pinned account. An agent with history resumes its
 * Claude session, which every account can read through the shared `projects/`.
 */
async function moveAgent(
  agent: AgentSession,
  previousPin: string | null,
  wasQueued: boolean,
  source: AccountSwitchSource,
): Promise<void> {
  const { agentId, sessionId } = agent;
  const hadHistory = agent.turnsCompleted > 0;
  const resumeRef = hadHistory
    ? liveConversation(agentId)?.sessionId
    : undefined;
  if (hadHistory && !resumeRef) {
    // Respawning would drop the conversation; it moves on its next resume.
    warn(`[agent:${agentId}] no Claude session to resume on the new account`);

    return;
  }
  const afterLimit =
    isLimitStalled(agentId) ||
    limitResumeAt(agentId) !== null ||
    (agent.accountId
      ? getClaudeAccount(agent.accountId)?.rate_limited === true
      : false);
  const capture = (success: boolean): void =>
    telemetryCapture("agent_account_switched", {
      had_history: hadHistory,
      queued: wasQueued,
      after_limit: afterLimit,
      source,
      success,
    });

  try {
    await respawnAgent(agentId, { keepModel: true, resumeRef });
  } catch (e) {
    // Don't leave the picker claiming an account the agent never got onto.
    // The transcript is untouched, so the chat resumes from history.
    setSessionClaudeAccount(sessionId, previousPin);
    capture(false);
    throw e;
  }
  // The new account isn't the one that ran out.
  forgetLimitResume(agentId);
  capture(true);
}

/**
 * Pin the session to `accountId` and move the picker's own agent onto it — at
 * once when idle, at the end of its turn when busy.
 */
export async function switchSessionClaudeAccount(
  sessionId: string,
  accountId: string | null,
  agentId?: string | null,
  source: AccountSwitchSource = "picker",
): Promise<void> {
  const previous = pinSessionAccount(sessionId, accountId);

  const agent = agentId ? appState.agents.get(agentId) : undefined;
  if (!agent || agent.sessionId !== sessionId || isGone(agent)) {
    return;
  }
  const pending = queued.get(agent.agentId);
  if (onAccount(agent)) {
    // Picked back the account it's on: nothing left to move.
    queued.delete(agent.agentId);

    return;
  }
  if (isAgentBusy(agent)) {
    if (!pending) {
      const entry = { previousPin: previous, waitingOn: agent, source };
      queued.set(agent.agentId, entry);
      waitForIdle(agent, entry);
    } else if (pending.waitingOn !== agent) {
      waitForIdle(agent, pending);
    }

    return;
  }
  queued.delete(agent.agentId);
  await moveAgent(agent, pending?.previousPin ?? previous, false, source);
}

/** `switchSessionClaudeAccount` for the command surface, which answers `null`. */
export async function pinSessionClaudeAccount(
  sessionId: string,
  accountId: string | null,
  agentId: string | null,
): Promise<null> {
  await switchSessionClaudeAccount(sessionId, accountId, agentId);

  return null;
}

/**
 * The limit card's button: pin the session to `accountId`, move the agent onto
 * it and send the "continue" its stalled turn needs.
 */
export async function handoffAgentToAccount(
  agentId: string,
  accountId: string,
): Promise<void> {
  const agent = appState.agents.get(agentId);
  if (!agent) {
    throw `No agent found: ${agentId}`;
  }
  if (!isLimitStalled(agentId)) {
    throw "This chat isn't waiting on a usage limit anymore.";
  }
  if (!handoffCandidates(agentId).some((a) => a.id === accountId)) {
    throw "That account can't take over right now.";
  }
  if (isAgentBusy(agent)) {
    throw "The agent is still working. Try again when its turn ends.";
  }
  await switchSessionClaudeAccount(
    agent.sessionId,
    accountId,
    agentId,
    "limit_card",
  );
  if (appState.agents.get(agentId)?.accountId !== accountId) {
    throw "The agent couldn't move to that account.";
  }
  sendAgentMessage(agentId, CONTINUE_MESSAGE);
  // The renderer only draws user bubbles for sends it made itself.
  emitHostEvent(`agent:remote-message:${agentId}`, {
    message: CONTINUE_MESSAGE,
    author: "Argus",
  });
}
