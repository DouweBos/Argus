/**
 * Native OS push notifications fired from the main process.
 *
 * Used by the MCP `push_notification` tool so an agent can alert the user
 * about something it is monitoring (a build that failed, a long-running
 * process that finished, etc.). Unlike the in-app `broadcastNotification`
 * toast channel, these surface in the OS notification center.
 */

import { Notification } from "electron";
import { appState } from "../../state";
import { showAgentNotification } from "./osNotification";

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

  showAgentNotification(
    {
      agent_id: input.agentId ?? null,
      session_id: ctx.sessionId,
      tool_use_id: null,
      tool_name: null,
      kind: "push",
      title,
      body: input.body,
    },
    { showLocal: true, urgency: input.urgency },
  );

  return { delivered: true };
}
