/**
 * Folding a chat's tool calls: runs of tool-only messages into one collapsed
 * row, or each turn's work into one log. The TS twin of ArgusKit's
 * `ToolGroups`, with the same tests.
 */

import type { RemoteMessage, RemoteToolCall } from "@argus/remote-protocol";

/** A lone call is left expanded — folding one row saves nothing. */
export const MIN_RUN = 2;

/** Calls that carry the substance of a turn, so a message holding one never folds into a run. */
const SUBSTANTIVE = new Set(["Agent", "Edit", "MultiEdit", "Write"]);

export type Segment =
  | { kind: "collapsed"; id: string; messages: RemoteMessage[] }
  | { kind: "single"; id: string; message: RemoteMessage };

export function segmentMessages(segment: Segment): RemoteMessage[] {
  return segment.kind === "single" ? [segment.message] : segment.messages;
}

function collapsed(messages: RemoteMessage[]): Segment {
  return { kind: "collapsed", id: `group-${messages[0]?.id ?? ""}`, messages };
}

function single(message: RemoteMessage): Segment {
  return { kind: "single", id: message.id, message };
}

const blank = (text: string) => text.trim().length === 0;

/** The agent deliberately reached for your phone; never fold that away. */
export function isPushNotification(call: RemoteToolCall): boolean {
  return call.name === "mcp__argus__push_notification";
}

export function isImageRead(call: RemoteToolCall): boolean {
  return (
    call.name === "Read" && call.result_blocks.some((b) => b.type === "image")
  );
}

/** A call waiting on approval, here or in a sub-agent under it, must never be folded out of sight. */
export function awaitsDecision(call: RemoteToolCall): boolean {
  if (call.status === "pending" || call.pending_permission === true) {
    return true;
  }

  return (call.children ?? []).some(
    (child) => child.kind === "tool_use" && awaitsDecision(child.tool_call),
  );
}

/** Thinking- or usage-only messages have nothing to draw and would split runs that should fold. */
export function hasVisibleContent(message: RemoteMessage): boolean {
  return (
    message.tool_calls.length > 0 ||
    (message.images ?? []).length > 0 ||
    message.is_error === true ||
    message.text_blocks.some((t) => !blank(t))
  );
}

export function isToolCallOnly(
  message: RemoteMessage,
  hoistImageReads = false,
): boolean {
  if (message.role !== "assistant" || message.tool_calls.length === 0) {
    return false;
  }
  if (!message.text_blocks.every(blank)) {
    return false;
  }

  return !message.tool_calls.some(
    (c) =>
      SUBSTANTIVE.has(c.name) ||
      isPushNotification(c) ||
      awaitsDecision(c) ||
      (hoistImageReads && isImageRead(c)),
  );
}

/** Runs of tool-only messages folded; everything else on its own. */
export function groupRuns(
  messages: RemoteMessage[],
  hoistImageReads = false,
): Segment[] {
  const segments: Segment[] = [];
  let run: RemoteMessage[] = [];
  const flush = () => {
    if (run.length >= MIN_RUN) {
      segments.push(collapsed(run));
    } else {
      segments.push(...run.map(single));
    }
    run = [];
  };
  for (const message of messages) {
    if (!hasVisibleContent(message)) {
      continue;
    }
    if (isToolCallOnly(message, hoistImageReads)) {
      run.push(message);
    } else {
      flush();
      segments.push(single(message));
    }
  }
  flush();

  return segments;
}

/** What a turn's work log never folds away: errors, decisions, a push, another agent's or tool's words. */
export function staysOpen(
  message: RemoteMessage,
  hoistImageReads = false,
): boolean {
  return (
    message.is_error === true ||
    message.source != null ||
    message.author != null ||
    message.tool_calls.some(
      (c) =>
        isPushNotification(c) ||
        awaitsDecision(c) ||
        (hoistImageReads && isImageRead(c)),
    )
  );
}

/** Text and nothing else: what the agent says rather than does. */
export function isReply(message: RemoteMessage): boolean {
  return (
    message.role === "assistant" &&
    message.tool_calls.length === 0 &&
    (message.images ?? []).length === 0 &&
    message.text_blocks.some((t) => !blank(t))
  );
}

/**
 * Each assistant turn's tool calls and the narration between them as one
 * collapsed segment; the user's messages, the turn's closing reply and
 * whatever `staysOpen` stand on their own. Work with no tool call isn't folded.
 */
export function groupTurns(
  messages: RemoteMessage[],
  hoistImageReads = false,
): Segment[] {
  const segments: Segment[] = [];
  let work: RemoteMessage[] = [];
  const flush = () => {
    let tail = work.length;
    while (tail > 0 && isReply(work[tail - 1])) {
      tail -= 1;
    }
    const folded = work.slice(0, tail);
    if (folded.some((m) => m.tool_calls.length > 0)) {
      segments.push(collapsed(folded));
    } else {
      segments.push(...folded.map(single));
    }
    segments.push(...work.slice(tail).map(single));
    work = [];
  };
  for (const message of messages) {
    if (!hasVisibleContent(message)) {
      continue;
    }
    if (message.role !== "assistant" || staysOpen(message, hoistImageReads)) {
      flush();
      segments.push(single(message));
    } else {
      work.push(message);
    }
  }
  flush();

  return segments;
}

export type ToolCategory =
  | "agent"
  | "bash"
  | "edit"
  | "other"
  | "read"
  | "search"
  | "web";

export function toolCategory(name: string): ToolCategory {
  switch (name) {
    case "Read":
    case "LS":
    case "NotebookRead":
      return "read";
    case "Grep":
    case "Glob":
      return "search";
    case "Bash":
    case "BashOutput":
    case "KillShell":
      return "bash";
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return "edit";
    case "WebFetch":
    case "WebSearch":
      return "web";
    case "Agent":
    case "Task":
      return "agent";
    default:
      return "other";
  }
}

/** Call counts per category, in the order each first appears. */
export function categorizeTools(
  messages: RemoteMessage[],
): [ToolCategory, number][] {
  const counts = new Map<ToolCategory, number>();
  for (const message of messages) {
    for (const call of message.tool_calls) {
      const category = toolCategory(call.name);
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
  }

  return [...counts.entries()];
}

export function countToolCalls(messages: RemoteMessage[]): number {
  return messages.reduce((sum, m) => sum + m.tool_calls.length, 0);
}
