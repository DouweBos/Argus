/**
 * EAS Simulator hosts as saved in `device-hosts.json`, under `easHosts` so the
 * SSH list stays readable by hosts that predate them. The Expo token is not
 * here: it is sealed in the secret store (`tokens.ts`).
 */

import type { EasDeviceHostInput } from "@argus/remote-protocol";
import { randomBytes } from "node:crypto";
import { readDeviceHostsKey, writeDeviceHostsFile } from "../config";

export interface EasHostConfig {
  appId: string | null;
  id: string;
  idleMinutes: number;
  label: string;
  maxConcurrentSessions: number;
  maxSessionMinutes: number;
}

/** EAS allows 40 minutes on free accounts and 115 on paid ones. */
export const EAS_LIMITS = {
  maxSessionMinutes: { min: 1, max: 115, default: 30 },
  idleMinutes: { min: 1, max: 60, default: 10 },
  maxConcurrentSessions: { min: 1, max: 20, default: 2 },
} as const;

const KEY = "easHosts";

/** `eh` + 8 hex, apart from SSH hosts' `rh`. */
const HOST_ID = /^eh[0-9a-f]{8}$/;

/** EAS project ids are UUIDs. */
const APP_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isEasHostId(id: string): boolean {
  return HOST_ID.test(id);
}

export function newEasHostId(): string {
  return `eh${randomBytes(4).toString("hex")}`;
}

const LIMIT_LABELS: Record<keyof typeof EAS_LIMITS, string> = {
  maxSessionMinutes: "Session minutes",
  idleMinutes: "Idle minutes",
  maxConcurrentSessions: "Concurrent sessions",
};

function limit(
  key: keyof typeof EAS_LIMITS,
  value: number | null | undefined,
  fallback: number,
): number {
  if (value === null || value === undefined) {
    return fallback;
  }
  const { min, max } = EAS_LIMITS[key];
  if (!Number.isInteger(value) || value < min || value > max) {
    throw `${LIMIT_LABELS[key]} must be a whole number from ${String(min)} to ${String(max)}.`;
  }

  return value;
}

/** Validate what the user typed over `base` (defaults for a new host). Throws a sentence. */
export function normalizeEasHostInput(
  input: EasDeviceHostInput,
  base?: Omit<EasHostConfig, "id">,
): Omit<EasHostConfig, "id"> {
  const label =
    input.label === undefined || input.label === null
      ? (base?.label ?? "EAS Simulator")
      : input.label.trim() || "EAS Simulator";
  if (label.length > 64) {
    throw "Keep the label under 64 characters.";
  }

  let appId = base?.appId ?? null;
  if (input.appId !== undefined && input.appId !== null) {
    const trimmed = input.appId.trim();
    if (trimmed && !APP_ID.test(trimmed)) {
      throw "The EAS project ID is a UUID: find it on expo.dev under the project's settings, or pick one after Check account.";
    }
    appId = trimmed ? trimmed.toLowerCase() : null;
  }

  const maxSessionMinutes = limit(
    "maxSessionMinutes",
    input.maxSessionMinutes,
    base?.maxSessionMinutes ?? EAS_LIMITS.maxSessionMinutes.default,
  );
  const idleMinutes = limit(
    "idleMinutes",
    input.idleMinutes,
    base?.idleMinutes ?? EAS_LIMITS.idleMinutes.default,
  );
  const maxConcurrentSessions = limit(
    "maxConcurrentSessions",
    input.maxConcurrentSessions,
    base?.maxConcurrentSessions ?? EAS_LIMITS.maxConcurrentSessions.default,
  );
  // EAS refuses a session whose idle limit isn't below its run limit.
  if (idleMinutes >= maxSessionMinutes) {
    throw "Idle minutes must be smaller than session minutes.";
  }

  return {
    label,
    appId,
    maxSessionMinutes,
    idleMinutes,
    maxConcurrentSessions,
  };
}

/** Saved EAS hosts, dropping any entry that no longer validates. */
export function loadEasHosts(): EasHostConfig[] {
  const raw = readDeviceHostsKey(KEY);
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.flatMap((entry) => {
    const e = entry as Partial<EasHostConfig>;
    if (typeof e.id !== "string" || !isEasHostId(e.id)) {
      return [];
    }
    try {
      return [
        {
          id: e.id,
          ...normalizeEasHostInput({
            label: typeof e.label === "string" ? e.label : null,
            appId: typeof e.appId === "string" ? e.appId : null,
            maxSessionMinutes: e.maxSessionMinutes,
            idleMinutes: e.idleMinutes,
            maxConcurrentSessions: e.maxConcurrentSessions,
          }),
        },
      ];
    } catch {
      return [];
    }
  });
}

export function saveEasHosts(hosts: EasHostConfig[]): void {
  writeDeviceHostsFile({ [KEY]: hosts });
}
