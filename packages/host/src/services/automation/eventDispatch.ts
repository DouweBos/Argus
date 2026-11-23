/**
 * The one way an event starts a run. The signal watcher, the webhook route and
 * any integration call `fireAutomationFromEvent`; it queues the event, and the
 * drain starts runs under the same rules as the clock: never two at once, at
 * most `max_runs_per_hour`, and everything that waited coalesces (`batch`) or
 * goes one at a time (`each`). Budget, scope and autonomy are the runner's, as
 * for every run.
 *
 * An automation accepts events when its trigger carries `fire` and
 * `max_runs_per_hour` — a new event-driven trigger kind only needs those two.
 */

import type { Automation, AutomationEvent, SignalFireMode } from "./models";
import fs from "node:fs";
import { warn } from "@argus/host/logger";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { writeJson } from "./jsonFile";
import { getAutomation, hasActiveRun } from "./manager";
import { automationEventQueueFilePath } from "./paths";
import { startAutomationRun } from "./runner";

/** Events kept waiting per automation; the oldest go first past this. */
export const MAX_QUEUED_EVENTS = 50;
const HOUR_MS = 60 * 60_000;

interface Pending {
  queue: AutomationEvent[];
  /** Epoch ms of each run started from events, for the hourly cap. */
  fired: number[];
}

let cache: Record<string, Pending> | null = null;
const capped = new Set<string>();

function load(): Record<string, Pending> {
  if (cache) {
    return cache;
  }
  try {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(automationEventQueueFilePath(), "utf8"),
    );
    cache =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, Pending>)
        : {};
  } catch {
    cache = {};
  }

  return cache;
}

function save(next: Record<string, Pending>): void {
  cache = next;
  try {
    writeJson(automationEventQueueFilePath(), next);
  } catch (e) {
    warn(`automation events: could not save the queue: ${String(e)}`);
  }
}

/** Test hook. */
export function resetEventDispatch(): void {
  cache = null;
  capped.clear();
}

export interface EventPolicy {
  fire: SignalFireMode;
  max_runs_per_hour: number;
}

/** How an automation takes events, or null when its trigger doesn't. */
export function eventPolicy(automation: Automation): EventPolicy | null {
  const trigger = automation.trigger as Partial<EventPolicy>;
  if (
    (trigger.fire === "each" || trigger.fire === "batch") &&
    typeof trigger.max_runs_per_hour === "number"
  ) {
    return { fire: trigger.fire, max_runs_per_hour: trigger.max_runs_per_hour };
  }

  return null;
}

export type FireResult =
  | { accepted: false; reason: string }
  | { accepted: true; queued: number };

/**
 * Hand an event to an automation. Returns once it is queued; the run (if the
 * rules allow one now) starts before this returns.
 */
export function fireAutomationFromEvent(
  automationId: string,
  event: AutomationEvent,
): FireResult {
  const result = enqueueAutomationEvents(automationId, [event]);
  if (!result.accepted) {
    return result;
  }
  drainAutomationEvents();

  return {
    accepted: true,
    queued: load()[automationId]?.queue.length ?? 0,
  };
}

/**
 * Queue several events without starting anything, so one poll's worth lands
 * in the same `batch` run. The caller drains.
 */
export function enqueueAutomationEvents(
  automationId: string,
  events: AutomationEvent[],
): FireResult {
  const automation = getAutomation(automationId);
  if (!automation) {
    return { accepted: false, reason: "No such automation." };
  }
  if (!automation.enabled) {
    return { accepted: false, reason: "The automation is paused." };
  }
  if (!eventPolicy(automation)) {
    return {
      accepted: false,
      reason: "The automation's trigger doesn't take events.",
    };
  }

  const state = load();
  const pending = state[automationId] ?? { queue: [], fired: [] };
  const queue = [...pending.queue, ...events];
  if (queue.length > MAX_QUEUED_EVENTS) {
    const dropped = queue.splice(0, queue.length - MAX_QUEUED_EVENTS);
    telemetryCapture("automation_event_fired", {
      trigger_kind: telemetryTriggerKind(automation),
      event_kind: telemetryEventKind(dropped),
      outcome: "dropped",
    });
  }
  save({ ...state, [automationId]: { ...pending, queue } });

  return { accepted: true, queued: queue.length };
}

/** Start whatever runs the rules allow now. Called on every scheduler tick. */
export function drainAutomationEvents(now: number = Date.now()): void {
  const state = load();
  let changed = false;
  const next: Record<string, Pending> = {};

  for (const [id, pending] of Object.entries(state)) {
    const automation = getAutomation(id);
    const policy = automation?.enabled ? eventPolicy(automation) : null;
    if (!automation || !policy) {
      // Paused, deleted or no longer event-driven: what waited is moot.
      changed = true;
      capped.delete(id);
      continue;
    }
    const fired = pending.fired.filter((t) => now - t < HOUR_MS);
    changed ||= fired.length !== pending.fired.length;
    next[id] = { queue: pending.queue, fired };
    if (pending.queue.length === 0 || hasActiveRun(id)) {
      continue;
    }
    if (fired.length >= policy.max_runs_per_hour) {
      if (!capped.has(id)) {
        capped.add(id);
        telemetryCapture("automation_event_fired", {
          trigger_kind: telemetryTriggerKind(automation),
          event_kind: telemetryEventKind(pending.queue),
          outcome: "rate_capped",
        });
      }
      continue;
    }

    capped.delete(id);
    const take = policy.fire === "each" ? 1 : pending.queue.length;
    const events = pending.queue.slice(0, take);
    next[id] = { queue: pending.queue.slice(take), fired: [...fired, now] };
    changed = true;
    telemetryCapture("automation_event_fired", {
      trigger_kind: telemetryTriggerKind(automation),
      event_kind: telemetryEventKind(events),
      outcome: "ran",
    });
    startAutomationRun(id, eventsReason(events), { events });
  }

  if (changed) {
    save(next);
  }
}

export function eventsReason(events: AutomationEvent[]): string {
  if (events.length === 1) {
    return events[0].summary;
  }

  return `${events.length} events`;
}

type TelemetryEventKind =
  | "assigned"
  | "ci_failed"
  | "mentioned"
  | "mixed"
  | "new_issue"
  | "new_pr"
  | "other"
  | "review_requested"
  | "webhook";

const KNOWN_KINDS: TelemetryEventKind[] = [
  "assigned",
  "ci_failed",
  "mentioned",
  "new_issue",
  "new_pr",
  "review_requested",
  "webhook",
];

function telemetryEventKind(events: AutomationEvent[]): TelemetryEventKind {
  const kinds = new Set(events.map((e) => e.kind));
  if (kinds.size > 1) {
    return "mixed";
  }
  const [kind] = kinds;

  return KNOWN_KINDS.find((k) => k === kind) ?? "other";
}

function telemetryTriggerKind(
  automation: Automation,
): "other" | "signal" | "webhook" {
  const { kind } = automation.trigger;

  return kind === "signal" || kind === "webhook" ? kind : "other";
}
