/**
 * Push to account devices through the account (phase 3). A device registers
 * once with the service and seals its push key for each account host, so a
 * host can wake a phone that never opened it. The host signs each send; the
 * service delivers only between live members of one account. Notifications
 * are sealed with the device's key exactly like the per-device relay path.
 */

import type { PushOutcome } from "../remote/push/types";
import { fromB64 } from "@argus/remote-protocol";
import { warn } from "@argus/host/logger";
import { getDesktopIdentity } from "../remote/deviceStore";
import { capture } from "../telemetry/telemetry";
import { AccountServiceError } from "./client";
import { memberClient } from "./lifecycle";
import { openPushKey } from "./pushKey";
import { currentRecord, currentState, isLinked } from "./trust";

export interface AccountPushTarget {
  device_id: string;
  label: string;
  service: "apns" | "fcm";
  environment: "production" | "sandbox";
  /** The device's 32-byte push key, opened from its sealed grant. */
  push_key: string;
}

/** A device that registers or re-seals shows up within this. */
const CACHE_MS = 2 * 60_000;

let cache: { at: number; head: number; targets: AccountPushTarget[] } | null =
  null;
let loading: Promise<AccountPushTarget[]> | null = null;

async function load(head: number): Promise<AccountPushTarget[]> {
  const record = currentRecord();
  const state = currentState();
  if (!record || !state) {
    return [];
  }
  let sealed;
  try {
    sealed = (await memberClient(record).pushKeys()).devices;
  } catch (err) {
    warn(`[account] push keys unavailable: ${(err as Error).message}`);
    // A service hiccup keeps the last good list; a refusal means we're out.
    const refused = err instanceof AccountServiceError && err.status < 500;

    return refused ? [] : (cache?.targets ?? []);
  }
  const identity = await getDesktopIdentity();
  const blocked = new Set(record.blocked_devices ?? []);
  const targets = sealed.flatMap((grant): AccountPushTarget[] => {
    const entry = state.members[grant.device_id];
    if (
      !entry?.live ||
      entry.member.role !== "device" ||
      blocked.has(grant.device_id) ||
      grant.device_id === record.device?.id
    ) {
      return [];
    }
    // Opens only if this device's own Noise key sealed it for us: the
    // service can't slip in a key of its own.
    const pushKey = openPushKey({
      hostNoisePriv: identity.priv,
      deviceNoisePub: fromB64(entry.member.noise_pub),
      deviceId: grant.device_id,
      hostId: record.host_id,
      sealed: grant.sealed,
    });

    return pushKey
      ? [
          {
            device_id: grant.device_id,
            label: entry.member.name,
            service: grant.service,
            environment: grant.environment,
            push_key: pushKey,
          },
        ]
      : [];
  });
  cache = { at: Date.now(), head, targets };

  return targets;
}

/** Account devices this host may push to, re-read when the log moves. */
export async function accountPushTargets(): Promise<AccountPushTarget[]> {
  const record = currentRecord();
  const state = currentState();
  if (!record || !state || !isLinked() || !record.config.enabled) {
    return [];
  }
  const head = state.head.seq;
  if (cache && cache.head === head && Date.now() - cache.at < CACHE_MS) {
    return cache.targets;
  }
  loading ??= load(head).finally(() => {
    loading = null;
  });

  return loading;
}

export function resetAccountPushCache(): void {
  cache = null;
}

function forget(deviceId: string): void {
  if (cache) {
    cache.targets = cache.targets.filter((t) => t.device_id !== deviceId);
  }
}

type SendOutcome = "delivered" | "failed" | "refused" | "unregistered";

function outcomeOf(status: number): SendOutcome {
  if (status === 401 || status === 403) {
    return "refused";
  }

  return status === 404 || status === 410 ? "unregistered" : "failed";
}

/** Deliver one sealed notification through the account service. */
export async function sendAccountPush(
  target: AccountPushTarget,
  sealed: string,
  collapseId: string | undefined,
): Promise<PushOutcome> {
  const record = currentRecord();
  if (!record || !isLinked()) {
    return { ok: false, retryable: false, reason: "not linked" };
  }
  try {
    const result = await memberClient(record).pushSend({
      device_id: target.device_id,
      sealed,
      ...(collapseId ? { collapse_id: collapseId } : {}),
    });
    capture("account_push_sent", { outcome: "delivered" });
    if (result.environment) {
      target.environment = result.environment;
    }

    return { ok: true };
  } catch (err) {
    if (!(err instanceof AccountServiceError)) {
      capture("account_push_sent", { outcome: "failed" });

      return { ok: false, retryable: true, reason: (err as Error).message };
    }
    const outcome = outcomeOf(err.status);
    const reason =
      typeof err.body.reason === "string" ? err.body.reason : err.code;
    const dead =
      outcome !== "failed" ||
      reason === "BadDeviceToken" ||
      reason === "Unregistered";
    capture("account_push_sent", {
      outcome: dead && outcome === "failed" ? "unregistered" : outcome,
    });
    if (dead) {
      forget(target.device_id);
    }

    return {
      ok: false,
      retryable: !dead && (err.status >= 500 || err.status === 429),
      reason,
    };
  }
}
