/**
 * Soft single-writer claim on a simulator's HID input.
 *
 * Two clients watching one device's video is fan-out and fine; two clients
 * injecting touches into it is nonsense. The host arbitrates: whoever interacts
 * first holds the device, everyone else is view-only until they take over
 * explicitly. Soft on purpose — a claim expires once idle and is dropped when
 * its connection goes away, so a client that falls off the network can never
 * wedge a device.
 *
 * The host's own renderer is never a claimant: someone sitting at the machine
 * keeps direct control, and the claim only arbitrates between remote clients.
 */

import type { RemoteDeviceClaimState } from "@argus/remote-protocol";
import { emitHostEvent } from "@argus/host/bus";

/** A claim left untouched this long is up for grabs without an explicit takeover. */
export const CLAIM_IDLE_MS = 30_000;

/**
 * How long a refused client stays listed as waiting. Long enough that the
 * person holding the device sees someone is trying, short enough that it clears
 * itself once they give up or wander off.
 */
export const WAITING_TTL_MS = 15_000;

export interface ClaimHolder {
  /** Per-connection token — the same device reconnecting is a new holder. */
  connectionId: string;
  deviceId: string;
  label: string;
}

/** The holder as clients see it. */
export interface PublicClaim {
  connection_id: string;
  device_id: string;
  label: string;
}

interface Claim {
  holder: ClaimHolder;
  lastInputAt: number;
}

const claims = new Map<string, Claim>();
/**
 * Who has been refused lately, by device then connection. Kept so the holder —
 * and the engineer at the desktop, whose own input is never arbitrated — can
 * see that someone else is trying to drive and getting nowhere.
 */
const waiting = new Map<
  string,
  Map<string, { holder: ClaimHolder; at: number }>
>();
/** Announces the idle lapse — without it a client stays stuck on "controlled by". */
const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelExpiry(deviceId: string): void {
  const timer = expiryTimers.get(deviceId);
  if (timer) {
    clearTimeout(timer);
    expiryTimers.delete(deviceId);
  }
}

function scheduleExpiry(deviceId: string): void {
  cancelExpiry(deviceId);
  const timer = setTimeout(() => {
    expiryTimers.delete(deviceId);
    if (claims.delete(deviceId)) {
      publish(deviceId);
    }
  }, CLAIM_IDLE_MS + 1);
  timer.unref?.();
  expiryTimers.set(deviceId, timer);
}

/** Everyone still actively trying, dropping anyone who has given up. */
function activeWaiting(deviceId: string): ClaimHolder[] {
  const entries = waiting.get(deviceId);
  if (!entries) {
    return [];
  }
  const now = Date.now();
  for (const [connectionId, entry] of [...entries]) {
    if (now - entry.at > WAITING_TTL_MS) {
      entries.delete(connectionId);
    }
  }
  if (entries.size === 0) {
    waiting.delete(deviceId);
  }

  return [...entries.values()].map((e) => e.holder);
}

/** Note a refusal, and say whether it is news worth publishing. */
function noteWaiting(deviceId: string, holder: ClaimHolder): boolean {
  const entries = waiting.get(deviceId) ?? new Map();
  const fresh = !entries.has(holder.connectionId);
  entries.set(holder.connectionId, { holder, at: Date.now() });
  waiting.set(deviceId, entries);

  return fresh;
}

/** They got the device (or left) — they are no longer waiting for it. */
function clearWaiting(deviceId: string, connectionId: string): void {
  const entries = waiting.get(deviceId);
  if (entries?.delete(connectionId) && entries.size === 0) {
    waiting.delete(deviceId);
  }
}

/** The live claim, dropping it first if it has gone idle. */
function activeClaim(deviceId: string): Claim | null {
  const claim = claims.get(deviceId);
  if (!claim) {
    return null;
  }
  if (Date.now() - claim.lastInputAt > CLAIM_IDLE_MS) {
    claims.delete(deviceId);
    cancelExpiry(deviceId);

    return null;
  }

  return claim;
}

function toPublic(claim: Claim | null): PublicClaim | null {
  return claim
    ? {
        connection_id: claim.holder.connectionId,
        device_id: claim.holder.deviceId,
        label: claim.holder.label,
      }
    : null;
}

/** Who holds interaction on this device right now, or null when it's free. */
export function getClaim(deviceId: string): PublicClaim | null {
  return toPublic(activeClaim(deviceId));
}

/**
 * Notified whenever a device changes hands. A single slot, wired by
 * `huddleService` so a room can re-push its roster — a guest's "who's driving"
 * mark has to move the moment the claim does.
 */
let claimChanged: ((deviceId: string) => void) | null = null;

export function setClaimChangedListener(
  cb: ((deviceId: string) => void) | null,
): void {
  claimChanged = cb;
}

function publish(deviceId: string): void {
  emitHostEvent("devices:claim-changed", claimState(deviceId));
  claimChanged?.(deviceId);
}

/** The claim as every client sees it — the event payload and the denial data. */
export function claimState(deviceId: string): RemoteDeviceClaimState {
  const holder = getClaim(deviceId);

  return {
    device_id: deviceId,
    holder,
    // Nobody waits for a free device: if the claim has lapsed, the next tap
    // takes it, so listing a "waiting" client would be a lie.
    waiting: holder
      ? activeWaiting(deviceId).map((h) => ({
          connection_id: h.connectionId,
          device_id: h.deviceId,
          label: h.label,
        }))
      : [],
  };
}

export interface ClaimResult {
  granted: boolean;
  /** The holder after the attempt — the incumbent when `granted` is false. */
  holder: PublicClaim | null;
}

/**
 * Take (or refresh) the claim. `force` is the explicit takeover: it steals from
 * a live holder, who finds out via `devices:claim-changed`.
 */
export function claimDevice(
  deviceId: string,
  holder: ClaimHolder,
  force = false,
): ClaimResult {
  const current = activeClaim(deviceId);
  const mine = current?.holder.connectionId === holder.connectionId;
  if (current && !mine && !force) {
    // Tell the room someone is trying. Only on the first refusal of a run —
    // a held-down finger refuses many times a second.
    if (noteWaiting(deviceId, holder)) {
      publish(deviceId);
    }

    return { granted: false, holder: toPublic(current) };
  }

  claims.set(deviceId, { holder, lastInputAt: Date.now() });
  clearWaiting(deviceId, holder.connectionId);
  scheduleExpiry(deviceId);
  if (!mine) {
    publish(deviceId);
  }

  return { granted: true, holder: getClaim(deviceId) };
}

/** Release a device, if this connection is the one holding it. */
export function releaseDevice(deviceId: string, connectionId: string): void {
  const claim = claims.get(deviceId);
  if (!claim || claim.holder.connectionId !== connectionId) {
    return;
  }
  claims.delete(deviceId);
  cancelExpiry(deviceId);
  publish(deviceId);
}

/** Drop every claim a connection held. Called when it disconnects. */
export function releaseConnection(connectionId: string): void {
  for (const [deviceId, claim] of [...claims]) {
    if (claim.holder.connectionId === connectionId) {
      claims.delete(deviceId);
      cancelExpiry(deviceId);
      publish(deviceId);
    }
  }
  // A client that has gone isn't waiting for anything any more.
  for (const deviceId of [...waiting.keys()]) {
    clearWaiting(deviceId, connectionId);
  }
}

/** Test seam: forget every claim without broadcasting. */
export function resetClaims(): void {
  claims.clear();
  waiting.clear();
  for (const timer of expiryTimers.values()) {
    clearTimeout(timer);
  }
  expiryTimers.clear();
}
