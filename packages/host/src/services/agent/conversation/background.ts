/**
 * Calls launched with `run_in_background`. Their tool_result only says they
 * started; the CLI's `task_notification` reports how they went, often long
 * after the turn that launched them ended. Ported to Swift as `BackgroundTasks`.
 */

import type {
  AgentConversation,
  BackgroundTask,
  ConversationMessage,
  LlmStreamEvent,
  ToolCallInfo,
} from "./types";
import { updateToolCallInMessages } from "./toolCalls";

const BACKGROUND_TOOLS = new Set(["Agent", "Bash", "Task"]);
const SUBAGENT_TOOLS = new Set(["Agent", "Task"]);

/** The tool_use asks to keep running past its own tool_result. */
export function isBackgroundLaunch(
  name: string,
  input: Record<string, unknown> | undefined,
): boolean {
  return BACKGROUND_TOOLS.has(name) && input?.run_in_background === true;
}

/** A fresh tool call, marked running when it launches in the background. */
export function newToolCall(
  id: string,
  name: string,
  input: Record<string, unknown>,
  now: number,
): ToolCallInfo {
  return isBackgroundLaunch(name, input)
    ? { id, name, input, background: { status: "running", startedAt: now } }
    : { id, name, input };
}

function findCall(calls: ToolCallInfo[], id: string): ToolCallInfo | undefined {
  for (const tc of calls) {
    if (tc.id === id) {
      return tc;
    }
    const nested = tc.children?.flatMap((c) =>
      c.kind === "tool_use" ? [c.toolCall] : [],
    );
    const found = nested && findCall(nested, id);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function findInMessages(
  messages: ConversationMessage[],
  id: string,
): ToolCallInfo | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const found = findCall(messages[i]!.toolCalls, id);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function withBackground(
  existing: AgentConversation,
  id: string,
  background: BackgroundTask,
): AgentConversation {
  const messages = updateToolCallInMessages(existing.messages, id, (tc) => ({
    ...tc,
    background,
  }));

  return messages ? { ...existing, messages } : existing;
}

/** `task_started`: a call moved to the background without asking up front. */
export function withTaskStarted(
  existing: AgentConversation,
  event: Extract<LlmStreamEvent, { subtype: "task_started" }>,
  now: number,
): AgentConversation {
  if (!event.is_backgrounded || !event.tool_use_id) {
    return existing;
  }
  const call = findInMessages(existing.messages, event.tool_use_id);
  if (!call || call.background) {
    return existing;
  }

  return withBackground(existing, event.tool_use_id, {
    status: "running",
    startedAt: now,
  });
}

/** `task_notification`: a background call settled. Foreground ones are ignored. */
export function withTaskNotification(
  existing: AgentConversation,
  event: Extract<LlmStreamEvent, { subtype: "task_notification" }>,
  now: number,
): AgentConversation {
  if (!event.tool_use_id) {
    return existing;
  }
  const call = findInMessages(existing.messages, event.tool_use_id);
  if (!call?.background) {
    return existing;
  }
  const status =
    event.status === "completed" || event.status === "failed"
      ? event.status
      : "stopped";
  const reported = event.usage?.duration_ms;

  return withBackground(existing, event.tool_use_id, {
    status,
    startedAt: call.background.startedAt,
    durationMs:
      typeof reported === "number"
        ? reported
        : Math.max(0, now - call.background.startedAt),
  });
}

function settleCall(tc: ToolCallInfo, now: number): ToolCallInfo {
  let next = tc;
  if (tc.background?.status === "running") {
    next = {
      ...next,
      background: {
        status: "stopped",
        startedAt: tc.background.startedAt,
        durationMs: Math.max(0, now - tc.background.startedAt),
      },
    };
  }
  if (tc.children?.some((c) => c.kind === "tool_use")) {
    let changed = false;
    const children = tc.children.map((c) => {
      if (c.kind !== "tool_use") {
        return c;
      }
      const settled = settleCall(c.toolCall, now);
      if (settled === c.toolCall) {
        return c;
      }
      changed = true;

      return { ...c, toolCall: settled };
    });
    if (changed) {
      next = { ...next, children };
    }
  }

  return next;
}

/** The CLI is gone, and its background tasks with it. Unchanged → same object. */
export function withBackgroundSettled(
  existing: AgentConversation,
  now: number,
): AgentConversation {
  let changed = false;
  const messages = existing.messages.map((m) => {
    if (!m.toolCalls.some(hasRunningBackground)) {
      return m;
    }
    changed = true;

    return { ...m, toolCalls: m.toolCalls.map((tc) => settleCall(tc, now)) };
  });

  return changed ? { ...existing, messages } : existing;
}

function hasRunningBackground(tc: ToolCallInfo): boolean {
  return (
    tc.background?.status === "running" ||
    (tc.children ?? []).some(
      (c) => c.kind === "tool_use" && hasRunningBackground(c.toolCall),
    )
  );
}

interface CallLike {
  background?: { status: string };
  name: string;
}

/** The messages' own calls still running in the background. */
export function runningBackgroundCalls<T extends CallLike>(
  messages: readonly { toolCalls: readonly T[] }[],
): T[] {
  return messages.flatMap((m) =>
    m.toolCalls.filter((tc) => tc.background?.status === "running"),
  );
}

/** "1 agent still running", "2 background tasks still running", or null. */
export function stillRunningLabel(calls: readonly CallLike[]): string | null {
  if (calls.length === 0) {
    return null;
  }
  const n = calls.length;
  if (calls.every((tc) => SUBAGENT_TOOLS.has(tc.name))) {
    return `${n} ${n === 1 ? "agent" : "agents"} still running`;
  }

  return `${n} background ${n === 1 ? "task" : "tasks"} still running`;
}

/** A Task/Agent call working in the foreground or the background. */
export function isSubagentWorking(tc: ToolCallInfo): boolean {
  if (!SUBAGENT_TOOLS.has(tc.name)) {
    return false;
  }
  if (tc.background) {
    return tc.background.status === "running";
  }

  return tc.result === undefined && !tc.pendingPermission;
}
