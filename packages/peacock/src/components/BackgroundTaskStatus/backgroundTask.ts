export type BackgroundTaskState =
  | "completed"
  | "failed"
  | "running"
  | "stopped";

export interface BackgroundTaskData {
  /** How long it ran, once it settled. */
  durationMs?: number;
  /** Epoch milliseconds. */
  startedAt: number;
  status: BackgroundTaskState;
}

/** "29s", "5m 29s", "1h 4m" — matches the Swift `ChromeText.duration`. */
export function formatTaskDuration(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  if (total < 60) {
    return `${total}s`;
  }
  const minutes = Math.floor(total / 60);
  if (minutes < 60) {
    return `${minutes}m ${total % 60}s`;
  }

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** "Running · 4m 12s", "Done in 18m 41s", "Failed after 3s", "Stopped after 1m 0s". */
export function backgroundTaskLabel(
  task: BackgroundTaskData,
  now: number,
): string {
  if (task.status === "running") {
    return `Running · ${formatTaskDuration(now - task.startedAt)}`;
  }
  const took = formatTaskDuration(task.durationMs ?? 0);
  if (task.status === "completed") {
    return `Done in ${took}`;
  }

  return `${task.status === "failed" ? "Failed" : "Stopped"} after ${took}`;
}
