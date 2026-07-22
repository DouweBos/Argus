/**
 * Native OS push notifications fired from the main process.
 *
 * Used by the MCP `push_notification` tool so an agent can alert the user
 * about something it is monitoring (a build that failed, a long-running
 * process that finished, etc.) regardless of whether the Argus window is
 * focused. Unlike the in-app `broadcastNotification` toast channel, these
 * surface in the OS notification center.
 */

import { Notification } from "electron";
import { getMainWindow } from "../../mainWindow";
import { appState } from "../../state";
import { broadcastRemoteNotification } from "./broadcast";

export type PushNotificationUrgency = "critical" | "normal";

export interface PushNotificationInput {
  title: string;
  body: string;
  agentId?: string;
  urgency?: PushNotificationUrgency;
}

export interface PushNotificationResult {
  delivered: boolean;
  reason?: string;
}

function resolveAgentContext(agentId: string | undefined): {
  resolvedTitle: string | null;
  sessionId: string | null;
} {
  if (!agentId) {
    return { resolvedTitle: null, sessionId: null };
  }
  const agent = appState.agents.get(agentId);
  if (!agent) {
    return { resolvedTitle: null, sessionId: null };
  }
  const session = appState.sessions.get(agent.sessionId);
  if (!session) {
    return { resolvedTitle: null, sessionId: agent.sessionId };
  }
  const projectName =
    session.repo_root.split("/").filter(Boolean).pop() ?? null;
  const sessionLabel = session.display_name ?? session.branch ?? "session";
  const prefix = projectName
    ? `${projectName} · ${sessionLabel}`
    : sessionLabel;

  return { resolvedTitle: prefix, sessionId: agent.sessionId };
}

export function sendPushNotification(
  input: PushNotificationInput,
): PushNotificationResult {
  if (!Notification.isSupported()) {
    return { delivered: false, reason: "OS notifications are not supported" };
  }

  const ctx = resolveAgentContext(input.agentId);
  const title = ctx.resolvedTitle
    ? `${ctx.resolvedTitle} — ${input.title}`
    : input.title;

  const notification = new Notification({
    title,
    body: input.body,
    urgency: input.urgency === "critical" ? "critical" : "normal",
  });

  notification.on("click", () => {
    const win = getMainWindow();
    if (win) {
      if (win.isMinimized()) {
        win.restore();
      }
      win.show();
      win.focus();
    }
    if (input.agentId && ctx.sessionId) {
      win?.webContents.send("agent_notification_clicked", {
        agent_id: input.agentId,
        session_id: ctx.sessionId,
      });
    }
  });

  notification.show();

  broadcastRemoteNotification({
    agent_id: input.agentId ?? null,
    session_id: ctx.sessionId,
    kind: "push",
    title,
    body: input.body,
  });

  return { delivered: true };
}
