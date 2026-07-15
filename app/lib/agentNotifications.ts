import type { PermissionRequest } from "./types";
import { getAgentState, setActiveAgent } from "../stores/agentStore";
import { getConversationState } from "../stores/conversationStore";
import { getSessionState, selectSession } from "../stores/sessionStore";
import { remoteNotify } from "./ipc";

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

interface SessionContext {
  projectName: string | null;
  sessionName: string;
}

function sessionContext(sessionId: string | undefined): SessionContext {
  if (!sessionId) {
    return { projectName: null, sessionName: "session" };
  }
  const ws = getSessionState().sessions.find((w) => w.id === sessionId);
  const sessionName = ws?.display_name ?? ws?.branch ?? "session";
  const projectName = ws?.repo_root
    ? (ws.repo_root.split("/").filter(Boolean).pop() ?? null)
    : null;

  return { projectName, sessionName };
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
  if (subtype === "success" && durationMs < MIN_TURN_DURATION_MS) {
    return;
  }

  const agent = getAgentState().agents[agentId];
  const ctx = sessionContext(agent?.session_id);
  const name = agentLabel(agentId);
  const project = ctx.projectName ?? "Project";
  const seconds = Math.max(1, Math.round(durationMs / 1000));

  const title =
    subtype === "error"
      ? `${project} agent failed`
      : `${project} agent finished`;
  const body =
    subtype === "error"
      ? `${ctx.sessionName} - ${name} ended with an error`
      : `${ctx.sessionName} - ${name} completed in ${seconds}s`;

  // Remote devices decide visibility from their own focus, so forward
  // regardless of whether this desktop window is focused.
  remoteNotify({
    agent_id: agentId,
    session_id: agent?.session_id ?? null,
    kind: subtype === "error" ? "failed" : "finished",
    title,
    body,
  }).catch(() => {});

  if (!canNotify()) {
    return;
  }
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
  const agent = getAgentState().agents[agentId];
  const ctx = sessionContext(agent?.session_id);
  const name = agentLabel(agentId);
  const project = ctx.projectName ?? "Project";

  const title = `${project} agent needs approval`;
  const body = `${ctx.sessionName} - ${name} requested ${request.tool_name}`;

  remoteNotify({
    agent_id: agentId,
    session_id: agent?.session_id ?? null,
    kind: "permission",
    title,
    body,
  }).catch(() => {});

  if (!canNotify()) {
    return;
  }
  const n = new Notification(title, { body, requireInteraction: true });
  n.onclick = () => {
    focusAgent(agentId);
    n.close();
  };
}
