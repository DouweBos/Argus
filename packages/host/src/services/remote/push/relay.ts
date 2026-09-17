/**
 * Client for the Argus push relay (`houwert.dev/argus/push`).
 *
 * Only the team that owns the phone app's bundle id can push to it, so the
 * APNs key can't ship in each copy of Argus. The relay holds it instead — but
 * it is not trusted with anything else: the payload is sealed for the target
 * device before it gets here, and every request is signed with a key that
 * device minted, so the relay can neither read notifications nor accept one
 * from someone the phone never authorised.
 */

import type { PushOutcome } from "./types";
import { createHash, createHmac } from "node:crypto";

export const DEFAULT_RELAY_URL = "https://houwert.dev/argus/push";

export interface RelayTarget {
  service: "apns" | "fcm";
  token: string;
  /** 32-byte HMAC key, base64. Registered with the relay by the device. */
  authKey: string;
  environment?: "production" | "sandbox";
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf-8").digest("hex");
}

/**
 * Bind the action, device, time, and body together, so a captured signature
 * can't be replayed against another device or another payload. Must match
 * `signingString` in the relay.
 */
function sign(
  authKey: string,
  action: string,
  target: RelayTarget,
  timestamp: number,
  bodyDigest: string,
): string {
  const message = [
    action,
    target.service,
    target.token,
    String(timestamp),
    bodyDigest,
  ].join("\n");

  return createHmac("sha256", Buffer.from(authKey, "base64"))
    .update(message, "utf-8")
    .digest("base64");
}

interface RelayResponse {
  delivered?: boolean;
  reason?: string;
  environment?: "production" | "sandbox";
}

/** Which APNs environment worked is only known after the relay's fallback. */
export type RelaySendResult = PushOutcome & {
  environment?: "production" | "sandbox";
};

/** Push a sealed notification. `sealed` is opaque to everyone but the device. */
export async function sendViaRelay(
  relayUrl: string,
  target: RelayTarget,
  sealed: string,
  collapseId: string | undefined,
  now: number,
): Promise<RelaySendResult> {
  const body = JSON.stringify({
    token: target.token,
    service: target.service,
    environment: target.environment,
    sealed,
    collapse_id: collapseId,
    ts: now,
  });

  let res: Response;
  try {
    res = await fetch(`${relayUrl.replace(/\/$/, "")}/send`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-argus-auth": sign(
          target.authKey,
          "send",
          target,
          now,
          sha256Hex(sealed),
        ),
      },
      body,
    });
  } catch (err) {
    return { ok: false, retryable: true, reason: (err as Error).message };
  }

  const parsed = (await res.json().catch(() => ({}))) as RelayResponse;
  if (res.ok && parsed.delivered) {
    return { ok: true, environment: parsed.environment };
  }

  return {
    ok: false,
    // 5xx is the relay or the provider wobbling; 401/404 mean this device is
    // no longer registered, which retrying will never fix.
    retryable: res.status >= 500 || res.status === 429,
    reason: parsed.reason ?? `HTTP ${res.status}`,
  };
}

/** Tell the relay to forget a device (on unpair, or a dead token). */
export async function revokeViaRelay(
  relayUrl: string,
  target: RelayTarget,
  now: number,
): Promise<void> {
  await fetch(`${relayUrl.replace(/\/$/, "")}/revoke`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-argus-auth": sign(
        target.authKey,
        "revoke",
        target,
        now,
        sha256Hex(""),
      ),
    },
    body: JSON.stringify({
      token: target.token,
      service: target.service,
      ts: now,
    }),
  }).catch(() => {});
}

/** Relay verdicts that mean the registration is gone for good. */
export function isRelayRegistrationDead(reason: string): boolean {
  return (
    reason === "unknown_device" ||
    reason === "unauthorized" ||
    reason === "BadDeviceToken" ||
    reason === "Unregistered" ||
    reason === "UNREGISTERED" ||
    reason === "HTTP 404"
  );
}
