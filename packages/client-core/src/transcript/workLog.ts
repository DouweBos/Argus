/**
 * A chat's rows with each turn's work folded into a "Worked for…" log. The
 * TS twin of ArgusCore's `WorkLog` / `TranscriptItems` and ArgusUI's
 * `WorkLog+Label`, with the same tests. Rebuilt whole on each change: React
 * memoizes on the message array, so the incremental bookkeeping Swift needs
 * for its table has no counterpart here.
 */

import type { RemoteMessage } from "@argus/remote-protocol";
import {
  lastBackgroundFinish,
  runningBackgroundCalls,
  stillRunningLabel,
} from "./backgroundTasks";
import {
  countToolCalls,
  groupRuns,
  groupTurns,
  segmentMessages,
  type Segment,
} from "./toolGroups";

/** A turn's folded work and the span it took. */
export interface WorkLog {
  id: string;
  messages: RemoteMessage[];
  /** When the turn began: the message before the log, epoch milliseconds. */
  started: number | null;
  /** When the work ended: the reply after it, else its own last message; null while it's the newest thing. */
  ended: number | null;
  /** What the turn launched in the background that hasn't reported back. */
  stillRunning: string | null;
}

/** A transcript row: a message, a run of tool calls (`runs` folding), or a turn's work. */
export type TranscriptItem =
  | { kind: "message"; id: string; message: RemoteMessage }
  | { kind: "run"; id: string; messages: RemoteMessage[] }
  | { kind: "work"; id: string; log: WorkLog };

export type Folding = "runs" | "turns";

/** A user's (or the system's) message: a turn's work never folds across one. */
function startsTurn(segment: Segment): boolean {
  return segment.kind === "single" && segment.message.role !== "assistant";
}

function workLog(segments: Segment[], position: number): WorkLog {
  const segment = segments[position];
  const messages = segmentMessages(segment);
  const before =
    position > 0 ? segmentMessages(segments[position - 1]).at(-1) : undefined;
  let ended: number | null = null;
  const next =
    position + 1 < segments.length
      ? segmentMessages(segments[position + 1])[0]
      : undefined;
  if (next) {
    ended =
      (next.role === "assistant"
        ? next.timestamp
        : messages.at(-1)?.timestamp) ?? null;
  }
  // The turn runs to the next user message: the reply after the log is where a background launch usually sits.
  let end = position + 1;
  while (end < segments.length && !startsTurn(segments[end])) {
    end += 1;
  }
  const turn = segments.slice(position, end).flatMap(segmentMessages);
  // Background agents are part of the turn's work: it ends when the last of them does.
  const settled = lastBackgroundFinish(turn);
  if (settled !== null && ended !== null && settled > ended) {
    ended = settled;
  }

  return {
    id: segment.id,
    messages,
    started: before?.timestamp ?? null,
    ended,
    stillRunning: stillRunningLabel(runningBackgroundCalls(turn)),
  };
}

export function transcriptItems(
  messages: RemoteMessage[],
  folding: Folding = "turns",
  hoistImageReads = false,
): TranscriptItem[] {
  const segments =
    folding === "turns"
      ? groupTurns(messages, hoistImageReads)
      : groupRuns(messages, hoistImageReads);

  return segments.map((segment, position): TranscriptItem => {
    if (segment.kind === "single") {
      return { kind: "message", id: segment.id, message: segment.message };
    }

    return folding === "turns"
      ? { kind: "work", id: segment.id, log: workLog(segments, position) }
      : { kind: "run", id: segment.id, messages: segment.messages };
  });
}

/** "42s", "5m 29s", "1h 3m". */
export function formatDuration(seconds: number): string {
  const total = Math.floor(Math.max(0, seconds));
  if (total < 60) {
    return `${total}s`;
  }
  const minutes = Math.floor(total / 60);
  if (minutes < 60) {
    return `${minutes}m ${total % 60}s`;
  }

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** "3 tool calls". */
export function workLogCallCount(log: WorkLog): string {
  const count = countToolCalls(log.messages);

  return `${count} tool call${count === 1 ? "" : "s"}`;
}

function workLabel(log: WorkLog, working: boolean, now: number): string {
  if (working) {
    return log.started === null
      ? "Working…"
      : `Working for ${formatDuration((now - log.started) / 1000)}`;
  }
  const end = log.ended ?? log.messages.at(-1)?.timestamp;
  const started = log.started ?? log.messages[0]?.timestamp;
  if (started === undefined || end === undefined || end <= started) {
    return workLogCallCount(log);
  }

  return `Worked for ${formatDuration((end - started) / 1000)}`;
}

/**
 * "Worked for 5m 29s", "Working for 12s" while the agent is still at it, or
 * the call count when there's no span; plus whatever is still running.
 */
export function workLogLabel(
  log: WorkLog,
  working: boolean,
  now: number = Date.now(),
): string {
  const base = workLabel(log, working, now);

  return log.stillRunning ? `${base} · ${log.stillRunning}` : base;
}

/** Still at it: a background agent it launched is, or it's the newest thing in a running chat. */
export function workLogIsWorking(log: WorkLog, agentRunning: boolean): boolean {
  return log.stillRunning !== null || (log.ended === null && agentRunning);
}
