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

function publish(deviceId: string): void {
  emitHostEvent("devices:claim-changed", claimState(deviceId));
}

/** The claim as every client sees it — the event payload and the denial data. */
export function claimState(deviceId: string): RemoteDeviceClaimState {
  return { device_id: deviceId, holder: getClaim(deviceId) };
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
    return { granted: false, holder: toPublic(current) };
  }

  claims.set(deviceId, { holder, lastInputAt: Date.now() });
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
}

/** Test seam: forget every claim without broadcasting. */
export function resetClaims(): void {
  claims.clear();
  for (const timer of expiryTimers.values()) {
    clearTimeout(timer);
  }
  expiryTimers.clear();
}
