/**
 * Pinning a chat: the host brings it back on its next start (`resume.ts`).
 * A pin outlives its agent — stopping or closing a pinned chat keeps it
 * pinned; only unpinning, or its session going away, drops it.
 */

import type { AgentSession } from "../models";
import { emitHostEvent } from "@argus/host/bus";
import { info } from "@argus/host/logger";
import { appState } from "../../../state";
import { capture as telemetryCapture } from "../../telemetry/telemetry";
import { loadHistoryIndex } from "../chatHistory";
import { liveConversation } from "../conversation/live";
import {
  type PinnedChat,
  getPin,
  isPinned,
  listPins,
  movePin,
  pinForRunnerSession,
  putPin,
  removePin,
  updatePin,
} from "./store";

/** Which host entry point asked: the desktop's IPC or a gateway client. */
export type PinVia = "ipc" | "remote";

/** What the pin of a live agent would hold right now. */
function liveFields(agent: AgentSession): Omit<PinnedChat, "pinnedAt"> {
  const conv = liveConversation(agent.agentId);
  const repoRoot = appState.sessions.get(agent.sessionId)?.repo_root ?? "";

  return {
    agentId: agent.agentId,
    sessionId: agent.sessionId,
    repoRoot,
    runnerSessionId: conv?.sessionId ?? undefined,
    runnerId: agent.runner.id,
    model: agent.model ?? undefined,
    permissionMode: agent.permissionMode ?? undefined,
    effort: agent.effort ?? undefined,
    title: conv?.title ?? undefined,
  };
}

/** Keep a pinned agent's record on its latest conversation and settings. */
export function refreshPin(agent: AgentSession): void {
  if (!isPinned(agent.agentId)) {
    return;
  }
  const { agentId: _id, repoRoot, ...fields } = liveFields(agent);
  updatePin(agent.agentId, { ...fields, ...(repoRoot ? { repoRoot } : {}) });
}

/**
 * A resume by hand of a pinned conversation whose agent is gone takes the
 * pin over, so the next start doesn't bring the conversation back twice.
 */
export function adoptPinOnResume(
  agentId: string,
  runnerSessionId: string,
): void {
  const pin = pinForRunnerSession(runnerSessionId);
  if (pin && pin.agentId !== agentId && !appState.agents.has(pin.agentId)) {
    movePin(pin.agentId, agentId);
    emitHostEvent(`agent:pinned:${pin.agentId}`, false);
    emitHostEvent(`agent:pinned:${agentId}`, true);
  }
}

function announce(agentId: string, pinned: boolean, target: string): void {
  emitHostEvent(`agent:pinned:${agentId}`, pinned);
  emitHostEvent("agent:pins-changed");
  info(`[agent:${agentId}] ${pinned ? "pinned" : "unpinned"} (${target})`);
}

/** Pin or unpin a live agent, or drop the pin of one already gone. */
export function setAgentPinned(
  agentId: string,
  pinned: boolean,
  via: PinVia,
): { pinned: boolean } {
  const agent = appState.agents.get(agentId);
  if (!pinned) {
    if (removePin(agentId)) {
      announce(agentId, false, "agent");
      telemetryCapture("agent_pinned", {
        action: "unpin",
        target: "agent",
        via,
      });
    }

    return { pinned: false };
  }
  if (isPinned(agentId)) {
    return { pinned: true };
  }
  if (!agent) {
    throw `No agent found: ${agentId}`;
  }
  const fields = liveFields(agent);
  if (!fields.repoRoot) {
    throw `Session not found: ${agent.sessionId}`;
  }
  putPin({ ...fields, pinnedAt: Date.now() });
  announce(agentId, true, "agent");
  telemetryCapture("agent_pinned", { action: "pin", target: "agent", via });

  return { pinned: true };
}

/** The pin a saved chat answers to, if any. */
export function pinForHistory(entry: {
  agentId?: string;
  sessionId: string;
}): PinnedChat | undefined {
  return (
    pinForRunnerSession(entry.sessionId) ??
    (entry.agentId ? getPin(entry.agentId) : undefined)
  );
}

/**
 * Pin or unpin a saved chat. Pinning one whose agent is gone records it to
 * come back on the next start, under the agent id it last ran as.
 */
export function setHistoryPinned(
  repoRoot: string,
  historyId: string,
  pinned: boolean,
  via: PinVia,
): { pinned: boolean } {
  const entry = loadHistoryIndex(repoRoot).find((e) => e.id === historyId);
  if (!entry) {
    throw `Saved chat not found: ${historyId}`;
  }
  if (entry.agentId && appState.agents.has(entry.agentId)) {
    return setAgentPinned(entry.agentId, pinned, via);
  }
  const existing = pinForHistory(entry);
  if (!pinned) {
    if (existing && removePin(existing.agentId)) {
      announce(existing.agentId, false, "saved_chat");
      telemetryCapture("agent_pinned", {
        action: "unpin",
        target: "saved_chat",
        via,
      });
    }

    return { pinned: false };
  }
  if (existing) {
    return { pinned: true };
  }
  if (!entry.argusSessionId || !appState.sessions.has(entry.argusSessionId)) {
    throw "The session this chat ran in no longer exists";
  }
  const agentId = entry.agentId ?? crypto.randomUUID();
  putPin({
    agentId,
    sessionId: entry.argusSessionId,
    repoRoot,
    runnerSessionId: entry.sessionId,
    runnerId: entry.runnerId,
    model: entry.model,
    permissionMode: entry.permissionMode,
    effort: entry.effort,
    title: entry.title,
    pinnedAt: Date.now(),
  });
  announce(agentId, true, "saved_chat");
  telemetryCapture("agent_pinned", {
    action: "pin",
    target: "saved_chat",
    via,
  });

  return { pinned: true };
}

/** A deleted session takes its pins with it. */
export function dropPinsForSession(sessionId: string): void {
  for (const pin of listPins()) {
    if (pin.sessionId === sessionId && removePin(pin.agentId)) {
      announce(pin.agentId, false, "session deleted");
    }
  }
}

export { isPinned, listPins } from "./store";
