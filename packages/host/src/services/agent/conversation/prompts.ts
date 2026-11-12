/**
 * Prompts the agent puts to the user. One is answerable only while the
 * runner process that asked holds it open; once that process is gone, or its
 * turn ends without an answer, the call settles as expired.
 */

import type {
  AgentConversation,
  ConversationMessage,
  ToolCallChild,
  ToolCallInfo,
} from "./types";

const AWAITS_ANSWER = new Set(["AskUserQuestion", "ExitPlanMode"]);

/** The result an expired prompt shows. */
export const UNANSWERED_RESULT = "Not answered";

export function isAwaitingAnswerTool(toolName: string): boolean {
  return AWAITS_ANSWER.has(toolName);
}

interface ExpireOptions {
  /** Prompts the host still holds open; they stay answerable. */
  live?: (toolUseId: string) => boolean;
  /** Leave sub-agent calls alone: a background sub-agent outlives its turn. */
  topLevelOnly?: boolean;
}

function expireCall(tc: ToolCallInfo, options: ExpireOptions): ToolCallInfo {
  let next = tc;
  if (tc.children && !options.topLevelOnly) {
    let changed = false;
    const children = tc.children.map((c): ToolCallChild => {
      if (c.kind !== "tool_use") {
        return c;
      }
      const call = expireCall(c.toolCall, options);
      if (call === c.toolCall) {
        return c;
      }
      changed = true;

      return { ...c, toolCall: call };
    });
    if (changed) {
      next = { ...next, children };
    }
  }
  const prompt = tc.pendingPermission || isAwaitingAnswerTool(tc.name);
  if (!prompt || options.live?.(tc.id)) {
    return next;
  }
  if (tc.result !== undefined) {
    if (!tc.pendingPermission) {
      return next;
    }
    const { pendingPermission: _stale, ...settled } = next;

    return settled;
  }
  const { pendingPermission: _stale, ...rest } = next;

  return { ...rest, result: UNANSWERED_RESULT, isError: false, expired: true };
}

/** Settle every prompt nobody can answer any more. Unchanged → same array. */
export function expirePrompts(
  messages: ConversationMessage[],
  options: ExpireOptions = {},
): ConversationMessage[] {
  let changed = false;
  const out = messages.map((m) => {
    let callsChanged = false;
    const toolCalls = m.toolCalls.map((tc) => {
      const next = expireCall(tc, options);
      if (next !== tc) {
        callsChanged = true;
      }

      return next;
    });
    if (!callsChanged) {
      return m;
    }
    changed = true;

    return { ...m, toolCalls };
  });

  return changed ? out : messages;
}

export function withPromptsExpired(
  existing: AgentConversation,
  options: ExpireOptions = {},
): AgentConversation {
  const messages = expirePrompts(existing.messages, options);

  return messages === existing.messages ? existing : { ...existing, messages };
}
