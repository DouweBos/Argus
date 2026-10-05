/**
 * The agent banners and pushes a UI would raise, for a host that owns its
 * conversations itself. Same wording as the desktop's.
 */

import path from "node:path";
import { appState } from "../../../state";
import {
  type AgentNotificationInput,
  showAgentNotification,
} from "../../notifications/osNotification";

const MIN_TURN_DURATION_MS = 10_000;
const AWAITS_ANSWER = new Set(["AskUserQuestion", "ExitPlanMode"]);

/** Whichever path notices a prompt first wins; the other is a no-op. */
const notified = new Set<string>();

export function isAwaitingAnswerTool(toolName: string): boolean {
  return AWAITS_ANSWER.has(toolName);
}

interface Context {
  name: string;
  project: string;
  sessionId: string | null;
  sessionName: string;
}

function context(sessionId: string | null, title?: string): Context {
  const session = sessionId ? appState.sessions.get(sessionId) : undefined;

  return {
    sessionId,
    sessionName: session?.display_name ?? session?.branch ?? "session",
    project: session?.repo_root
      ? path.basename(session.repo_root) || "Project"
      : "Project",
    name: title?.trim() ? title : "Agent",
  };
}

function dispatch(input: AgentNotificationInput): void {
  // Nobody is at this host's screen; the phone is who gets told.
  showAgentNotification(input, { showLocal: false });
}

function claim(agentId: string, toolUseId: string): boolean {
  const key = `${agentId}:${toolUseId}`;
  if (notified.has(key)) {
    return false;
  }
  notified.add(key);
  if (notified.size > 500) {
    notified.delete(notified.values().next().value as string);
  }

  return true;
}

export function notifyFinished(
  agentId: string,
  sessionId: string | null,
  title: string | undefined,
  durationMs: number,
  failed: boolean,
): void {
  if (!failed && durationMs < MIN_TURN_DURATION_MS) {
    return;
  }
  const ctx = context(sessionId, title);
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  dispatch({
    agent_id: agentId,
    session_id: sessionId,
    tool_use_id: null,
    tool_name: null,
    kind: failed ? "failed" : "finished",
    title: failed
      ? `${ctx.project} agent failed`
      : `${ctx.project} agent finished`,
    body: failed
      ? `${ctx.sessionName} - ${ctx.name} ended with an error`
      : `${ctx.sessionName} - ${ctx.name} completed in ${seconds}s`,
  });
}

export function notifyPrompt(
  agentId: string,
  sessionId: string | null,
  title: string | undefined,
  toolUseId: string,
  toolName: string,
  permission: boolean,
): void {
  if (!claim(agentId, toolUseId)) {
    return;
  }
  const ctx = context(sessionId, title);
  let what = `requested ${toolName}`;
  if (!permission) {
    what =
      toolName === "ExitPlanMode"
        ? "wants to run its plan by you"
        : "asked you a question";
  }
  dispatch({
    agent_id: agentId,
    session_id: sessionId,
    tool_use_id: toolUseId,
    tool_name: toolName,
    kind: "permission",
    title: permission
      ? `${ctx.project} agent needs approval`
      : `${ctx.project} agent needs you`,
    body: `${ctx.sessionName} - ${ctx.name} ${what}`,
  });
}
