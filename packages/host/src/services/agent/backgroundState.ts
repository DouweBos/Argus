/**
 * What a Claude Code CLI still has going once its turn is over, which killing
 * it would lose. Fails closed: what it hasn't told us counts as work.
 */

import { createReadStream } from "node:fs";
import { warn } from "@argus/host/logger";

/** What a runner reports as the main turn stops. */
export interface TurnStop {
  /** Live background tasks, or null when it didn't say. */
  tasks: number | null;
  /** Wakeups, loops and crons that will start a turn later, or null when it didn't say. */
  scheduled: number | null;
}

export interface BackgroundState {
  /** Live background tasks, without the ambient ones. */
  tasks: number;
  /** The CLI announces task changes, which outrank a stop's snapshot. */
  announcesTasks: boolean;
  scheduled: number | null;
  /** A stop reported, with nothing from the main thread since. */
  stopped: boolean;
  /** The CLI's state events end its turns; before one, results do. */
  announcesState: boolean;
  /** Something newer than the transcript has spoken for `scheduled`. */
  settled: boolean;
}

export function newBackgroundState(resumed: boolean): BackgroundState {
  return {
    tasks: 0,
    announcesTasks: false,
    scheduled: resumed ? null : 0,
    stopped: false,
    announcesState: false,
    settled: false,
  };
}

export function foldTurnStop(state: BackgroundState, stop: TurnStop): void {
  state.stopped = true;
  state.settled = true;
  state.scheduled = stop.scheduled;
  if (!state.announcesTasks && stop.tasks !== null) {
    state.tasks = stop.tasks;
  }
}

function endTurn(state: BackgroundState): void {
  // An interrupt, a failure or a local command ends a turn without a stop.
  if (!state.stopped) {
    state.scheduled = null;
  }
  state.stopped = false;
  state.settled = true;
}

interface Event {
  type?: string;
  subtype?: string;
  state?: string;
  parent_tool_use_id?: string | null;
  tasks?: { ambient?: boolean }[];
}

export function foldBackgroundLine(state: BackgroundState, line: string): void {
  const relevant =
    line.includes('"background_tasks_changed"') ||
    line.includes('"session_state_changed"') ||
    (!state.announcesState && line.includes('"result"')) ||
    (state.stopped && line.includes('"assistant"'));
  if (!relevant) {
    return;
  }
  let event: Event;
  try {
    event = JSON.parse(line) as Event;
  } catch {
    return;
  }
  if (event.type === "assistant" && !event.parent_tool_use_id) {
    // Another hook kept the turn going, so that stop's snapshot is stale.
    state.stopped = false;
  } else if (event.type === "result" && !state.announcesState) {
    endTurn(state);
  } else if (event.type !== "system") {
    return;
  } else if (event.subtype === "background_tasks_changed") {
    if (Array.isArray(event.tasks)) {
      state.announcesTasks = true;
      state.tasks = event.tasks.filter((t) => t?.ambient !== true).length;
    }
  } else if (event.subtype === "session_state_changed") {
    state.announcesState = true;
    if (event.state === "idle") {
      endTurn(state);
    }
  }
}

const SCHEDULING_CALLS = [
  Buffer.from('"name":"CronCreate"'),
  Buffer.from('"name":"ScheduleWakeup"'),
];
const OVERLAP = Math.max(...SCHEDULING_CALLS.map((call) => call.length));

async function hasSchedulingCall(file: string): Promise<boolean> {
  let tail = Buffer.alloc(0);
  for await (const chunk of createReadStream(file)) {
    const bytes = Buffer.concat([tail, chunk as Buffer]);
    if (SCHEDULING_CALLS.some((call) => bytes.includes(call))) {
      return true;
    }
    tail = bytes.subarray(Math.max(0, bytes.length - OVERLAP));
  }

  return false;
}

/** A resume knows nothing is scheduled only if its transcript never scheduled. */
export async function scanResumedTranscript(
  state: BackgroundState,
  file: string | null,
): Promise<void> {
  if (!file) {
    return;
  }
  try {
    const scheduled = await hasSchedulingCall(file);
    if (!scheduled && !state.settled) {
      state.scheduled = 0;
    }
  } catch (e) {
    warn(`[agents] couldn't scan a resumed transcript: ${String(e)}`);
  }
}
