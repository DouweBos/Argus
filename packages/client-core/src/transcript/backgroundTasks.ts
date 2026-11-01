/**
 * Calls launched with `run_in_background`: the host marks them running until
 * the CLI's task notification settles them. Mirrors ArgusCore's
 * `BackgroundTasks` and the host's `background.ts`.
 */

import type { RemoteMessage, RemoteToolCall } from "@argus/remote-protocol";

const SUBAGENT_TOOLS = new Set(["Agent", "Task"]);

/** The messages' own calls still running in the background. */
export function runningBackgroundCalls(
  messages: RemoteMessage[],
): RemoteToolCall[] {
  return messages.flatMap((m) =>
    m.tool_calls.filter((c) => c.background?.status === "running"),
  );
}

/** When the last settled background call finished, epoch milliseconds. */
export function lastBackgroundFinish(messages: RemoteMessage[]): number | null {
  let latest: number | null = null;
  for (const call of messages.flatMap((m) => m.tool_calls)) {
    const task = call.background;
    if (!task || task.status === "running" || task.duration_ms === undefined) {
      continue;
    }
    const end = task.started_at + task.duration_ms;
    latest = latest === null ? end : Math.max(latest, end);
  }

  return latest;
}

/** "1 agent still running", "2 background tasks still running", or null. */
export function stillRunningLabel(calls: RemoteToolCall[]): string | null {
  const count = calls.length;
  if (count === 0) {
    return null;
  }
  if (calls.every((c) => SUBAGENT_TOOLS.has(c.name))) {
    return `${count} ${count === 1 ? "agent" : "agents"} still running`;
  }

  return `${count} background ${count === 1 ? "task" : "tasks"} still running`;
}
