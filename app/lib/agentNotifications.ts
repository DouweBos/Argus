import type { PermissionRequest } from "./types";
import { getAgentState, setActiveAgent } from "../stores/agentStore";
import { getWorkspaceState, selectWorkspace } from "../stores/workspaceStore";

const MIN_TURN_DURATION_MS = 10_000;

function canNotify(): boolean {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission !== "granted") return false;
  if (typeof document !== "undefined" && document.hasFocus()) return false;

  return true;
}

function workspaceLabel(workspaceId: string | undefined): string {
  if (!workspaceId) return "workspace";
  const ws = getWorkspaceState().workspaces.find((w) => w.id === workspaceId);

  return ws?.display_name ?? ws?.branch ?? "workspace";
}

function focusAgent(agentId: string): void {
  window.focus();
  const agent = getAgentState().agents[agentId];
  if (!agent) return;
  selectWorkspace(agent.workspace_id);
  setActiveAgent(agent.workspace_id, agentId);
}

export function notifyAgentFinished(
  agentId: string,
  durationMs: number,
  subtype: "error" | "success",
): void {
  if (!canNotify()) return;
  if (subtype === "success" && durationMs < MIN_TURN_DURATION_MS) return;

  const agent = getAgentState().agents[agentId];
  const label = workspaceLabel(agent?.workspace_id);
  const seconds = Math.max(1, Math.round(durationMs / 1000));

  const title =
    subtype === "error" ? `Agent failed · ${label}` : `Agent finished · ${label}`;
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
  if (!canNotify()) return;

  const agent = getAgentState().agents[agentId];
  const label = workspaceLabel(agent?.workspace_id);
  const title = `Permission requested · ${label}`;
  const body = `${request.tool_name} needs your approval`;

  const n = new Notification(title, { body, requireInteraction: true });
  n.onclick = () => {
    focusAgent(agentId);
    n.close();
  };
}
