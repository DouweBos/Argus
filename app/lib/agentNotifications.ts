import type { PermissionRequest } from "./types";
import { getAgentState } from "../stores/agentStore";
import { getConversationState } from "../stores/conversationStore";
import { getSessionState } from "../stores/sessionStore";
import { notifyAgent, type NotifyAgentPayload } from "./ipc";

const MIN_TURN_DURATION_MS = 10_000;

/**
 * Whether to raise a banner on this Mac. Remote devices judge their own focus,
 * so this only gates the local half — the fan-out always happens.
 */
function showLocally(): boolean {
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

function dispatch(payload: NotifyAgentPayload): void {
  notifyAgent(payload, showLocally()).catch(() => {});
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

  dispatch({
    agent_id: agentId,
    session_id: agent?.session_id ?? null,
    tool_use_id: null,
    tool_name: null,
    kind: subtype === "error" ? "failed" : "finished",
    title,
    body,
  });
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

  dispatch({
    agent_id: agentId,
    session_id: agent?.session_id ?? null,
    tool_use_id: request.tool_use_id,
    tool_name: request.tool_name,
    kind: "permission",
    title,
    body,
  });
}
