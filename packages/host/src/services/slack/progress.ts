/**
 * What the agent is doing, in a few words, read off its stream. The Slack
 * status message shows this instead of every tool call.
 */

import { resultSubtype } from "../agent/models";

export type Activity =
  | "browsing"
  | "done"
  | "editing"
  | "failed"
  | "reading"
  | "running"
  | "searching"
  | "starting"
  | "stopped"
  | "testing"
  | "thinking"
  | "waiting";

export const ACTIVITY_LABEL: Record<Activity, string> = {
  starting: "Starting up",
  thinking: "Thinking",
  reading: "Reading files",
  searching: "Searching the code",
  editing: "Editing files",
  testing: "Running tests",
  running: "Running commands",
  browsing: "Looking things up",
  waiting: "Waiting for your answer",
  done: "Done",
  failed: "Stopped with an error",
  stopped: "Stopped",
};

const TEST_COMMAND =
  /\b(test|tests|vitest|jest|pytest|xcodebuild\s+test|swift\s+test|gradlew\s+\S*test|go\s+test|cargo\s+test|rspec|mocha|playwright)\b/i;

export function activityForTool(
  name: string,
  input: Record<string, unknown> | undefined,
): Activity {
  switch (name) {
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
      return "editing";
    case "Read":
    case "LS":
      return "reading";
    case "Grep":
    case "Glob":
      return "searching";
    case "WebFetch":
    case "WebSearch":
      return "browsing";
    case "AskUserQuestion":
    case "ExitPlanMode":
      return "waiting";
    case "Bash": {
      const command = typeof input?.command === "string" ? input.command : "";

      return TEST_COMMAND.test(command) ? "testing" : "running";
    }
    default:
      return "thinking";
  }
}

interface StreamLine {
  type?: string;
  parent_tool_use_id?: string | null;
  message?: {
    content?: {
      type?: string;
      name?: string;
      input?: Record<string, unknown>;
    }[];
  };
}

/** The activity a stream line shows, or null when it changes nothing. */
export function activityForStreamLine(line: string): Activity | null {
  let event: StreamLine;
  try {
    event = JSON.parse(line) as StreamLine;
  } catch {
    return null;
  }
  if (event.type !== "assistant") {
    return null;
  }
  let activity: Activity | null = null;
  for (const block of event.message?.content ?? []) {
    if (block.type === "tool_use" && block.name) {
      activity = activityForTool(block.name, block.input);
    } else if (block.type === "thinking" || block.type === "text") {
      activity ??= "thinking";
    }
  }

  return activity;
}

/** The final reply text from a `result` line, when the line is one. */
export function resultOfStreamLine(
  line: string,
): { text: string; failed: boolean } | null {
  let event: {
    type?: string;
    result?: unknown;
    subtype?: string;
    is_error?: boolean;
  };
  try {
    event = JSON.parse(line) as typeof event;
  } catch {
    return null;
  }
  if (event.type !== "result") {
    return null;
  }

  return {
    text: typeof event.result === "string" ? event.result : "",
    failed: resultSubtype(event) === "error",
  };
}
