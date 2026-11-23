/**
 * The pure half of the signal trigger: which events match, and which of them
 * are new since the last poll.
 *
 * Sources report what is true now; an event fires the first time its key is
 * seen. A key that has been gone for a while is forgotten, so an item that is
 * assigned again later fires again, while a source that blinks out for one
 * poll doesn't refire everything when it comes back.
 */

import type { AutomationTrigger } from "./models";
import type { SignalEvent, SignalEventKind } from "../signals/types";
import { SIGNAL_EVENT_KINDS } from "../signals/types";

export type SignalTrigger = Extract<AutomationTrigger, { kind: "signal" }>;
export type EventTrigger = Extract<
  AutomationTrigger,
  { kind: "signal" | "webhook" }
>;

export const MAX_RUNS_PER_HOUR = 60;
export const DEFAULT_RUNS_PER_HOUR = 4;
/** How long a key may be missing before it can fire again. */
export const FORGET_AFTER_MS = 60 * 60_000;

/** What the watcher remembers per automation between polls. */
export interface SignalWatchState {
  /** The trigger config this state was built for; a change rebaselines. */
  key: string;
  /** Event key → when it was last reported. */
  seen: Record<string, number>;
}

export function assertValidEventTrigger(trigger: EventTrigger): void {
  const cap = trigger.max_runs_per_hour;
  if (!Number.isInteger(cap) || cap < 1 || cap > MAX_RUNS_PER_HOUR) {
    throw `Runs per hour must be a whole number from 1 to ${MAX_RUNS_PER_HOUR}.`;
  }
  if (trigger.fire !== "each" && trigger.fire !== "batch") {
    throw `Unknown fire mode: ${String(trigger.fire)}`;
  }
  if (trigger.kind !== "signal") {
    return;
  }
  if (trigger.on.length === 0) {
    throw "Pick at least one event for the signal trigger to react to.";
  }
  const unknown = trigger.on.filter((k) => !SIGNAL_EVENT_KINDS.includes(k));
  if (unknown.length > 0) {
    throw `Unknown signal event: ${unknown.join(", ")}`;
  }
}

/** Trimmed, de-duplicated, case-preserving labels. */
export function normalizeSignalLabels(labels: string[]): string[] {
  const out: string[] = [];
  for (const raw of labels) {
    const label = raw.trim();
    if (label && !out.some((l) => l.toLowerCase() === label.toLowerCase())) {
      out.push(label);
    }
  }

  return out;
}

/** Known kinds only, in the canonical order, once each. */
export function normalizeSignalKinds(kinds: string[]): SignalEventKind[] {
  return SIGNAL_EVENT_KINDS.filter((k) => kinds.includes(k));
}

export function signalStateKey(
  trigger: SignalTrigger,
  repoRoots: string[],
): string {
  return JSON.stringify({
    on: [...trigger.on].sort(),
    labels: normalizeSignalLabels(trigger.labels)
      .map((l) => l.toLowerCase())
      .sort(),
    roots: [...repoRoots].sort(),
  });
}

/**
 * Events the trigger cares about. Labels are any-of, case-insensitive. An item
 * mapped to a repo outside a non-empty scope is ignored; one with no repo
 * (a Linear issue) is not.
 */
export function matchingEvents(
  events: SignalEvent[],
  trigger: SignalTrigger,
  repoRoots: string[],
): SignalEvent[] {
  const wanted = normalizeSignalLabels(trigger.labels).map((l) =>
    l.toLowerCase(),
  );

  return events.filter(({ kind, item }) => {
    if (!trigger.on.includes(kind)) {
      return false;
    }
    if (
      repoRoots.length > 0 &&
      item.repo_root !== null &&
      !repoRoots.includes(item.repo_root)
    ) {
      return false;
    }

    return (
      wanted.length === 0 ||
      item.labels.some((l) => wanted.includes(l.toLowerCase()))
    );
  });
}

export interface SignalDecision {
  /** Events to hand to the dispatcher, oldest first. Empty on a baseline. */
  fresh: SignalEvent[];
  baseline: boolean;
  state: SignalWatchState;
}

/**
 * One poll's decision. A first poll (or one after the filter changed) only
 * records what is already true, so turning a trigger on never fires on the
 * backlog.
 */
export function decideSignalEvents(opts: {
  key: string;
  previous: SignalWatchState | null;
  matching: SignalEvent[];
  now: number;
}): SignalDecision {
  const { key, previous, matching, now } = opts;
  const baseline = !previous || previous.key !== key;
  const seen: Record<string, number> = {};
  if (!baseline) {
    for (const [k, at] of Object.entries(previous.seen)) {
      if (now - at < FORGET_AFTER_MS) {
        seen[k] = at;
      }
    }
  }

  const fresh: SignalEvent[] = [];
  const keys = new Set<string>();
  for (const event of [...matching].sort(
    (a, b) => a.item.updated_at - b.item.updated_at,
  )) {
    if (keys.has(event.key)) {
      continue;
    }
    keys.add(event.key);
    if (!baseline && !(event.key in seen)) {
      fresh.push(event);
    }
    seen[event.key] = now;
  }

  return { fresh: baseline ? [] : fresh, baseline, state: { key, seen } };
}
