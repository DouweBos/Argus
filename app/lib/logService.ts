/**
 * Global log buffer that starts collecting `log:entry` events
 * immediately on import — before any React component mounts.
 *
 * Components read from this buffer and subscribe to updates via
 * `subscribe()`.
 */

import { listen } from "../lib/events";

export interface LogEntry {
  level: string;
  message: string;
  target: string;
  timestamp_ms: number;
}

const MAX_ENTRIES = 2000;

let entries: LogEntry[] = [];
const listeners = new Set<() => void>();

// Start collecting immediately on module load.
listen<LogEntry>("log:entry", (event) => {
  entries = [...entries, event.payload];
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(-MAX_ENTRIES);
  }
  for (const fn of listeners) fn();
});

/** Current snapshot of all buffered log entries. */
export function getLogEntries(): LogEntry[] {
  return entries;
}

/** Clear all buffered entries. */
export function clearLogEntries(): void {
  entries = [];
  for (const fn of listeners) fn();
}

/** Subscribe to entry changes. Returns an unsubscribe function. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
