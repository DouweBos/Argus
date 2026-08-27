/**
 * Collapse runs of tool-call-only assistant messages into one segment, so a
 * long chain of reads/searches reads as a single line instead of scrolling
 * past dozens of cards. Mirrors the desktop's AgentChat grouping.
 */

import type { RemoteMessage } from "./protocol";

/** Fewer than this in a row renders normally — collapsing single turns hurts. */
const MIN_RUN = 3;

export type ToolCategory =
  | "agent"
  | "bash"
  | "edit"
  | "other"
  | "read"
  | "search"
  | "web";

export type Segment =
  | { type: "collapsed"; messages: RemoteMessage[] }
  | { type: "single"; message: RemoteMessage };

/**
 * An assistant message that is nothing but tool calls. Edits, writes and
 * sub-agents are excluded — those carry the substance of a turn, so they stay
 * visible rather than being folded away.
 */
function isToolCallOnly(msg: RemoteMessage): boolean {
  return (
    msg.role === "assistant" &&
    msg.tool_calls.length > 0 &&
    msg.text_blocks.every((t) => t.trim().length === 0) &&
    !msg.tool_calls.some(
      (tc) =>
        tc.name === "Agent" ||
        tc.name === "Edit" ||
        tc.name === "MultiEdit" ||
        tc.name === "Write",
    )
  );
}

export function groupMessages(messages: RemoteMessage[]): Segment[] {
  const segments: Segment[] = [];
  let run: RemoteMessage[] = [];

  const flush = () => {
    if (run.length >= MIN_RUN) {
      segments.push({ type: "collapsed", messages: run });
    } else {
      for (const m of run) {
        segments.push({ type: "single", message: m });
      }
    }
    run = [];
  };

  for (const msg of messages) {
    if (isToolCallOnly(msg)) {
      run.push(msg);
    } else {
      flush();
      segments.push({ type: "single", message: msg });
    }
  }
  flush();

  return segments;
}

/** Count a group's tool calls per category, for the collapsed summary icons. */
export function categorizeTools(
  messages: RemoteMessage[],
): Record<ToolCategory, number> {
  const categories: Record<ToolCategory, number> = {
    read: 0,
    search: 0,
    edit: 0,
    bash: 0,
    web: 0,
    agent: 0,
    other: 0,
  };
  for (const msg of messages) {
    for (const tc of msg.tool_calls) {
      switch (tc.name) {
        case "Read":
          categories.read++;
          break;
        case "Glob":
        case "Grep":
        case "LS":
          categories.search++;
          break;
        case "Edit":
        case "MultiEdit":
        case "Write":
          categories.edit++;
          break;
        case "Bash":
          categories.bash++;
          break;
        case "WebSearch":
        case "WebFetch":
          categories.web++;
          break;
        case "Agent":
          categories.agent++;
          break;
        default:
          categories.other++;
          break;
      }
    }
  }

  return categories;
}

/** Total tool calls across a group. */
export function countToolCalls(messages: RemoteMessage[]): number {
  return messages.reduce((sum, m) => sum + m.tool_calls.length, 0);
}
