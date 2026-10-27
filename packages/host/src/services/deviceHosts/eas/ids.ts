/** EAS device ids (`eas:<hostId>:<slot>`, one per session a host may run) and shared shapes. */

export const EAS_ID_PREFIX = "eas:";

export function easDeviceId(hostId: string, slot: number): string {
  return `${EAS_ID_PREFIX}${hostId}:${String(slot)}`;
}

export function parseEasDeviceId(
  id: string,
): { hostId: string; slot: number } | null {
  const m = /^eas:(eh[0-9a-f]{8}):(\d{1,2})$/.exec(id);
  if (!m) {
    return null;
  }
  const slot = Number(m[2]);

  return slot >= 1 && slot <= 20 ? { hostId: m[1], slot } : null;
}

export type EasEndReason =
  | "closed"
  | "expired"
  | "host_removed"
  | "leftover"
  | "shutdown";

export function durationBucket(
  ms: number | null,
): "<10m" | "<30m" | "<60m" | ">=60m" | "unknown" {
  if (ms === null) {
    return "unknown";
  }
  const min = ms / 60_000;

  if (min < 10) {
    return "<10m";
  }
  if (min < 30) {
    return "<30m";
  }

  return min < 60 ? "<60m" : ">=60m";
}

export function waitBucket(ms: number): "<1m" | "<3m" | "<10m" | ">=10m" {
  const min = ms / 60_000;

  if (min < 1) {
    return "<1m";
  }
  if (min < 3) {
    return "<3m";
  }

  return min < 10 ? "<10m" : ">=10m";
}

/** A running session's serve-sim. Its token grants full control and stays on the host. */
export interface ServeSimEndpoint {
  origin: string;
  token: string;
  udid: string;
}
