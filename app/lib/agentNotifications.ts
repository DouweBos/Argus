import type { PermissionRequest } from "./types";
import { getAgentState, setActiveAgent } from "../stores/agentStore";
import { getConversationState } from "../stores/conversationStore";
import { getSessionState, selectSession } from "../stores/sessionStore";

const MIN_TURN_DURATION_MS = 10_000;

function canNotify(): boolean {
  if (typeof Notification === "undefined") {
    return false;
  }
  if (Notification.permission !== "granted") {
    return false;
  }
  if (typeof document !== "undefined" && document.hasFocus()) {
    return false;
  }

  return true;
}

function sessionLabel(sessionId: string | undefined): string {
  if (!sessionId) {
    return "session";
  }
  const ws = getSessionState().sessions.find((w) => w.id === sessionId);

  return ws?.display_name ?? ws?.branch ?? "session";
}

function agentLabel(agentId: string): string {
  const title = getConversationState().conversations[agentId]?.title;

  return title?.trim() ? title : "Agent";
}

function focusAgent(agentId: string): void {
  window.focus();
  const agent = getAgentState().agents[agentId];
  if (!agent) {
    return;
  }
  selectSession(agent.session_id);
  setActiveAgent(agent.session_id, agentId);
}

export function notifyAgentFinished(
  agentId: string,
  durationMs: number,
  subtype: "error" | "success",
): void {
  if (!canNotify()) {
    return;
  }
  if (subtype === "success" && durationMs < MIN_TURN_DURATION_MS) {
    return;
  }

  const agent = getAgentState().agents[agentId];
  const session = sessionLabel(agent?.session_id);
  const name = agentLabel(agentId);
  const label = `${name} · ${session}`;
  const seconds = Math.max(1, Math.round(durationMs / 1000));

  const title =
    subtype === "error"
      ? `Agent failed · ${label}`
      : `Agent finished · ${label}`;
  const body =
    subtype === "error"
      ? "Turn ended with an error — click to view"
      : `Turn completed in ${seconds}s — click to view`;

  const n = new Notification(title, { body });
  n.onclick = () => {
    focusAgent(agentId);
    n.close();
  };
}

export function notifyPermissionRequested(
  agentId: string,
  request: PermissionRequest,
): void {
  if (!canNotify()) {
    return;
  }

  const agent = getAgentState().agents[agentId];
  const session = sessionLabel(agent?.session_id);
  const name = agentLabel(agentId);
  const title = `Permission requested · ${name} · ${session}`;
  const body = `${request.tool_name} needs your approval`;

  const n = new Notification(title, { body, requireInteraction: true });
  n.onclick = () => {
    focusAgent(agentId);
    n.close();
  };
}
