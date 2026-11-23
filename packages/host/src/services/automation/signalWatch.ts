/**
 * The signal trigger's poller. Driven by the scheduler's tick, it asks the
 * connected sources what is true now for each enabled signal automation every
 * few minutes and queues new events with the dispatcher (`eventDispatch.ts`). Decisions
 * live in `signalTrigger.ts`; this file owns fetching, the persisted state and
 * the in-flight guard.
 */

import type { Automation, AutomationEvent } from "./models";
import type { SignalTrigger, SignalWatchState } from "./signalTrigger";
import type { SignalEvent } from "../signals/types";
import fs from "node:fs";
import { warn } from "@argus/host/logger";
import { collectSignalEvents, enrichSignalEvent } from "../signals/registry";
import {
  drainAutomationEvents,
  enqueueAutomationEvents,
} from "./eventDispatch";
import { writeJson } from "./jsonFile";
import { listAutomations } from "./manager";
import { signalWatchFilePath } from "./paths";
import {
  decideSignalEvents,
  matchingEvents,
  signalStateKey,
} from "./signalTrigger";

/** How often a signal trigger looks; `gh search` allows 30 calls a minute. */
export const SIGNAL_POLL_MS = 2 * 60_000;
/** A failing job's log is a download; past this many new events, skip it. */
const MAX_ENRICHED = 5;

const lastPoll = new Map<string, number>();
const inFlight = new Set<string>();
let cache: Record<string, SignalWatchState> | null = null;

function loadState(): Record<string, SignalWatchState> {
  if (cache) {
    return cache;
  }
  try {
    const parsed: unknown = JSON.parse(
      fs.readFileSync(signalWatchFilePath(), "utf8"),
    );
    cache =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, SignalWatchState>)
        : {};
  } catch {
    cache = {};
  }

  return cache;
}

function saveState(state: Record<string, SignalWatchState>): void {
  cache = state;
  try {
    writeJson(signalWatchFilePath(), state);
  } catch (e) {
    warn(`signal watch: could not save state: ${String(e)}`);
  }
}

/** Test hook: forget everything held in memory. */
export function resetSignalWatch(): void {
  cache = null;
  lastPoll.clear();
  inFlight.clear();
}

/**
 * Poll every signal automation that is due. Resolves once this call's polls
 * have settled, so tests can await it; the scheduler doesn't.
 */
export async function pollSignalTriggers(now: number): Promise<void> {
  const state = loadState();
  const live = new Set<string>();
  const polls: Promise<void>[] = [];

  for (const automation of listAutomations()) {
    if (!automation.enabled || automation.trigger.kind !== "signal") {
      continue;
    }
    live.add(automation.id);
    const last = lastPoll.get(automation.id) ?? 0;
    if (inFlight.has(automation.id) || now - last < SIGNAL_POLL_MS) {
      continue;
    }
    lastPoll.set(automation.id, now);
    inFlight.add(automation.id);
    polls.push(
      pollOne(automation, automation.trigger, now)
        .catch((e: unknown) => {
          warn(`signal watch ${automation.id}: ${String(e)}`);
        })
        .finally(() => inFlight.delete(automation.id)),
    );
  }

  // Paused or deleted: drop the baseline, so turning it back on never fires
  // on whatever piled up in between.
  const stale = Object.keys(state).filter((id) => !live.has(id));
  if (stale.length > 0) {
    const next = { ...state };
    for (const id of stale) {
      delete next[id];
      lastPoll.delete(id);
    }
    saveState(next);
  }

  await Promise.all(polls);
}

async function pollOne(
  automation: Automation,
  trigger: SignalTrigger,
  now: number,
): Promise<void> {
  const repoRoots = automation.scope.repo_roots;
  const { events } = await collectSignalEvents({
    kinds: trigger.on,
    repoRoots,
  });
  const decision = decideSignalEvents({
    key: signalStateKey(trigger, repoRoots),
    previous: loadState()[automation.id] ?? null,
    matching: matchingEvents(events, trigger, repoRoots),
    now,
  });
  saveState({ ...loadState(), [automation.id]: decision.state });

  if (decision.fresh.length === 0) {
    return;
  }
  const fired = await Promise.all(
    decision.fresh.map(async (raw, i) =>
      toAutomationEvent(
        i < MAX_ENRICHED ? await enrichSignalEvent(raw) : raw,
        now,
      ),
    ),
  );
  enqueueAutomationEvents(automation.id, fired);
  drainAutomationEvents(now);
}

export function toAutomationEvent(
  event: SignalEvent,
  now: number,
): AutomationEvent {
  return {
    origin: "signal",
    kind: event.kind,
    summary: `${event.kind} ${event.item.external_id}`,
    items: [event.item],
    payload: { kind: event.kind, ...event.detail },
    received_at: now,
  };
}
