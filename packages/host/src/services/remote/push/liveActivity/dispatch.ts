/**
 * Pushes the phone's Live Activity along as agents work.
 *
 * The phone starts the activity and hands over its push token; from then on
 * this host is its only source of updates, connected or not, so there is one
 * path to reason about. Everything that names an agent is sealed for the
 * device: the relay and Apple see a coarse phase and ciphertext. The phone's
 * widget extension opens it with the key the notification extension uses.
 */

import type { RelayTarget } from "../relay";
import type { ActivityPhase, ActivitySnapshot } from "./state";
import { addHostEventSink } from "@argus/host/bus";
import { log, warn } from "@argus/host/logger";
import { capture } from "../../../telemetry/telemetry";
import { getPushConfig } from "../../deviceStore";
import { relayUrlFor } from "../config";
import { isRelayRegistrationDead, sendActivityViaRelay } from "../relay";
import { sealJson } from "../seal";
import { collectAgents, recordStatus, resetCollected } from "./collect";
import { isSettled, phaseOf, snapshotOf } from "./state";

/** A phase change or a new prompt goes out at once. */
const URGENT_DELAY_MS = 300;
/** Tool-by-tool progress is batched; Apple throttles a chatty activity. */
const STEP_INTERVAL_MS = 10_000;
/** Settled this long before ending, so a queued follow-up doesn't end it. */
const END_GRACE_MS = 60_000;
/** Shown dimmed past this if the host goes quiet (asleep, quit). */
const STALE_AFTER_S = 60 * 60;
/** Leaves the relay headroom under APNs' 4 KB. */
const MAX_SEALED_CHARS = 3072;

export interface LiveActivityRegistration {
  token: string;
  environment?: "production" | "sandbox";
  pushKey: string;
  authKey: string;
}

interface Tracked {
  target: RelayTarget;
  pushKey: string;
  sent: string | null;
  sentPhase: ActivityPhase | null;
  sentPrompts: string;
  sentAt: number;
  settledSince: number | null;
  timer: ReturnType<typeof setTimeout> | null;
  dueAt: number;
  updates: number;
  failures: number;
}

/** One activity per device: a phone shows this host's agents on one card. */
const tracked = new Map<string, Tracked>();
let detach: (() => void) | null = null;

/** The snapshot as of now, for the activity's first frame. */
export function currentActivitySnapshot(now = Date.now()): ActivitySnapshot {
  return snapshotOf(collectAgents(now), now);
}

export function registerLiveActivity(
  deviceId: string,
  registration: LiveActivityRegistration,
): void {
  const existing = tracked.get(deviceId);
  if (existing?.timer) {
    clearTimeout(existing.timer);
  }
  // A token rotation keeps what was sent; a new activity starts clean.
  const sameActivity = existing?.target.token === registration.token;
  tracked.set(deviceId, {
    target: {
      service: "apns",
      token: registration.token,
      authKey: registration.authKey,
      environment: registration.environment,
    },
    pushKey: registration.pushKey,
    sent: sameActivity ? existing.sent : null,
    sentPhase: sameActivity ? existing.sentPhase : null,
    sentPrompts: sameActivity ? existing.sentPrompts : "",
    sentAt: 0,
    settledSince: null,
    timer: null,
    dueAt: 0,
    updates: existing?.updates ?? 0,
    failures: existing?.failures ?? 0,
  });
  schedule(deviceId, URGENT_DELAY_MS);
}

export function unregisterLiveActivity(deviceId: string): void {
  forget(deviceId, "unregistered");
}

function forget(
  deviceId: string,
  reason: "settled" | "token_dead" | "unregistered",
): void {
  const entry = tracked.get(deviceId);
  if (!entry) {
    return;
  }
  if (entry.timer) {
    clearTimeout(entry.timer);
  }
  tracked.delete(deviceId);
  capture("live_activity_ended", {
    reason,
    updates: entry.updates,
    failed_sends: entry.failures,
  });
}

function schedule(deviceId: string, delayMs: number): void {
  const entry = tracked.get(deviceId);
  if (!entry) {
    return;
  }
  const dueAt = Date.now() + delayMs;
  if (entry.timer && entry.dueAt <= dueAt) {
    return;
  }
  if (entry.timer) {
    clearTimeout(entry.timer);
  }
  entry.dueAt = dueAt;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    flush(deviceId).catch((err: unknown) => {
      warn(`[live-activity] ${(err as Error).message}`);
    });
  }, delayMs);
}

function scheduleAll(urgent: boolean): void {
  const now = Date.now();
  for (const [deviceId, entry] of tracked) {
    const delay = urgent
      ? URGENT_DELAY_MS
      : Math.max(URGENT_DELAY_MS, entry.sentAt + STEP_INTERVAL_MS - now);
    schedule(deviceId, delay);
  }
}

/** Seals the snapshot, dropping agents until it fits. */
function sealSnapshot(
  pushKey: string,
  now: number,
): {
  sealed: string;
  snapshot: ActivitySnapshot;
} {
  const agents = collectAgents(now);
  for (let limit = 3; ; limit--) {
    const snapshot = snapshotOf(agents, now, limit);
    const sealed = sealJson(pushKey, snapshot);
    if (sealed.length <= MAX_SEALED_CHARS || limit <= 1) {
      return { sealed, snapshot };
    }
  }
}

async function flush(deviceId: string): Promise<void> {
  const entry = tracked.get(deviceId);
  if (!entry) {
    return;
  }
  const now = Date.now();
  const { sealed, snapshot } = sealSnapshot(entry.pushKey, now);
  const settled = isSettled(snapshot);
  if (settled && entry.settledSince === null) {
    entry.settledSince = now;
  } else if (!settled) {
    entry.settledSince = null;
  }
  const ending = settled && now - (entry.settledSince ?? now) >= END_GRACE_MS;
  if (settled && !ending) {
    schedule(deviceId, END_GRACE_MS - (now - (entry.settledSince ?? now)));
  }

  const body = JSON.stringify(snapshot);
  if (!ending && body === entry.sent) {
    return;
  }
  const phase = phaseOf(snapshot);
  const prompts = snapshot.agents
    .flatMap((a) => (a.prompt ? [a.prompt.toolUseId] : []))
    .join(",");
  const urgent =
    ending || phase !== entry.sentPhase || prompts !== entry.sentPrompts;
  const config = await getPushConfig();
  if (!config.enabled) {
    return;
  }
  const payload = JSON.stringify({
    event: ending ? "end" : "update",
    state: { p: phase, e: sealed, t: now },
    priority: urgent ? 10 : 5,
    stale_at: Math.floor(now / 1000) + STALE_AFTER_S,
    // Finished work stays readable a while after the last agent stops.
    ...(ending ? { dismiss_at: Math.floor(now / 1000) + 15 * 60 } : {}),
  });
  const result = await sendActivityViaRelay(
    relayUrlFor(config),
    entry.target,
    payload,
    now,
  );
  if (tracked.get(deviceId) !== entry) {
    return;
  }
  if (result.ok) {
    entry.sent = body;
    entry.sentPhase = phase;
    entry.sentPrompts = prompts;
    entry.sentAt = now;
    entry.updates++;
    if (result.environment) {
      entry.target.environment = result.environment;
    }
    if (ending) {
      log(`[live-activity] ended for ${deviceId}`);
      forget(deviceId, "settled");
    }

    return;
  }
  entry.failures++;
  if (isActivityTokenDead(result.reason)) {
    forget(deviceId, "token_dead");

    return;
  }
  warn(`[live-activity] ${deviceId}: ${result.reason}`);
  if (result.retryable) {
    schedule(deviceId, STEP_INTERVAL_MS);
  }
}

/** An activity the user dismissed, or one that ran its course, is gone. */
export function isActivityTokenDead(reason: string): boolean {
  return (
    isRelayRegistrationDead(reason) ||
    reason === "ExpiredToken" ||
    reason === "HTTP 410"
  );
}

const AGENT_CHANNEL = /^agent:([a-z-]+):(.+)$/;

function onHostEvent(channel: string, payload: unknown): void {
  if (channel === "agent:started") {
    scheduleAll(true);

    return;
  }
  const match = AGENT_CHANNEL.exec(channel);
  if (!match) {
    return;
  }
  const [, kind, agentId] = match;
  switch (kind) {
    case "status":
      recordStatus(agentId!, String(payload), Date.now());
      scheduleAll(true);
      break;
    case "permission":
    case "permission-cancel":
    case "permission-resolved":
      scheduleAll(true);
      break;
    case "event":
      scheduleAll(false);
      break;
  }
}

export function startLiveActivities(): void {
  detach ??= addHostEventSink((channel, args) => {
    try {
      onHostEvent(channel, args[0]);
    } catch (err) {
      warn(`[live-activity] ${channel}: ${String(err)}`);
    }
  });
}

export function stopLiveActivities(): void {
  detach?.();
  detach = null;
  for (const entry of tracked.values()) {
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
  }
  tracked.clear();
  resetCollected();
}
