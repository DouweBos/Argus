/**
 * Direct APNs provider. The desktop signs its own ES256 provider JWT and talks
 * HTTP/2 to Apple, so background push needs no Argus-operated server — only the
 * user's own APNs auth key.
 */

import type { PushConfig } from "../deviceStore";
import { createPrivateKey, sign as cryptoSign } from "node:crypto";
import http2 from "node:http2";
import { warn } from "../../../../app/lib/logger";

export interface ApnsPayload {
  title: string;
  body: string;
  /**
   * Opaque data echoed back to the app when the notification is tapped.
   * Flattened alongside `aps` because expo-notifications surfaces the whole
   * iOS userInfo dictionary as `content.data`.
   */
  data: Record<string, string>;
  /** Collapse id — a newer notification replaces an unread older one. */
  collapseId?: string;
  /**
   * Notification category. iOS renders the buttons the app registered for this
   * category, so the desktop only names it — the titles live on the phone.
   */
  category?: string;
}

export type PushOutcome =
  | { ok: false; retryable: boolean; reason: string }
  | { ok: true };

const HOSTS = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
} as const;

export type ApnsEnvironment = keyof typeof HOSTS;

/** Apple rejects provider tokens older than 60 minutes; refresh well before. */
const TOKEN_TTL_MS = 45 * 60 * 1000;

interface CachedJwt {
  value: string;
  issuedAt: number;
  fingerprint: string;
}

let cachedJwt: CachedJwt | null = null;

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function configFingerprint(config: PushConfig): string {
  return `${config.apns_key_id}:${config.apns_team_id}:${config.apns_key_p8.length}`;
}

/** Mint (or reuse) the provider JWT Apple wants in `authorization`. */
export function apnsProviderToken(config: PushConfig, now: number): string {
  const fingerprint = configFingerprint(config);
  if (
    cachedJwt &&
    cachedJwt.fingerprint === fingerprint &&
    now - cachedJwt.issuedAt < TOKEN_TTL_MS
  ) {
    return cachedJwt.value;
  }

  const header = base64url(
    JSON.stringify({ alg: "ES256", kid: config.apns_key_id, typ: "JWT" }),
  );
  const claims = base64url(
    JSON.stringify({
      iss: config.apns_team_id,
      iat: Math.floor(now / 1000),
    }),
  );
  const key = createPrivateKey({ key: config.apns_key_p8, format: "pem" });
  // ieee-p1363 gives the raw r||s JOSE signature; the default DER form is rejected.
  const signature = cryptoSign("sha256", Buffer.from(`${header}.${claims}`), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  const value = `${header}.${claims}.${base64url(signature)}`;
  cachedJwt = { value, issuedAt: now, fingerprint };

  return value;
}

/** Drop the cached JWT so the next send re-signs (used after a 403). */
export function resetApnsToken(): void {
  cachedJwt = null;
}

/** One pooled HTTP/2 session per environment, reconnected lazily on close. */
const sessions = new Map<ApnsEnvironment, http2.ClientHttp2Session>();

function session(env: ApnsEnvironment): http2.ClientHttp2Session {
  const existing = sessions.get(env);
  if (existing && !existing.closed && !existing.destroyed) {
    return existing;
  }
  const next = http2.connect(HOSTS[env]);
  next.on("error", (err) => {
    warn(`[push] APNs session error: ${err.message}`);
    sessions.delete(env);
  });
  next.on("close", () => sessions.delete(env));
  next.unref();
  sessions.set(env, next);

  return next;
}

export function closeApnsSessions(): void {
  for (const s of sessions.values()) {
    s.close();
  }
  sessions.clear();
}

/** True when every field APNs needs is present. */
export function isApnsConfigured(config: PushConfig): boolean {
  return Boolean(
    config.apns_key_p8.trim() &&
    config.apns_key_id.trim() &&
    config.apns_team_id.trim() &&
    config.apns_bundle_id.trim(),
  );
}

const REQUEST_TIMEOUT_MS = 10_000;

/** The JSON APNs receives. Custom keys sit beside `aps`, never inside it. */
export function buildApnsBody(payload: ApnsPayload): string {
  return JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: "default",
      "interruption-level": "active",
      // iOS looks up the app's registered category to render the buttons.
      ...(payload.category ? { category: payload.category } : {}),
    },
    ...payload.data,
  });
}

export function sendApns(
  config: PushConfig,
  deviceToken: string,
  environment: ApnsEnvironment,
  payload: ApnsPayload,
  now: number,
): Promise<PushOutcome> {
  if (!isApnsConfigured(config)) {
    return Promise.resolve({
      ok: false,
      retryable: false,
      reason: "APNs is not configured",
    });
  }

  let jwt: string;
  try {
    jwt = apnsProviderToken(config, now);
  } catch (err) {
    return Promise.resolve({
      ok: false,
      retryable: false,
      reason: `bad APNs key: ${(err as Error).message}`,
    });
  }

  const body = buildApnsBody(payload);

  return new Promise<PushOutcome>((resolve) => {
    let settled = false;
    const done = (outcome: PushOutcome): void => {
      if (!settled) {
        settled = true;
        resolve(outcome);
      }
    };

    let req: http2.ClientHttp2Stream;
    try {
      req = session(environment).request({
        ":method": "POST",
        ":path": `/3/device/${deviceToken}`,
        authorization: `bearer ${jwt}`,
        "apns-topic": config.apns_bundle_id,
        "apns-push-type": "alert",
        "apns-priority": "10",
        ...(payload.collapseId
          ? { "apns-collapse-id": payload.collapseId.slice(0, 64) }
          : {}),
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      });
    } catch (err) {
      done({ ok: false, retryable: true, reason: (err as Error).message });

      return;
    }

    let status = 0;
    let raw = "";
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.close(http2.constants.NGHTTP2_CANCEL);
      done({ ok: false, retryable: true, reason: "APNs request timed out" });
    });
    req.on("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
    });
    req.setEncoding("utf-8");
    req.on("data", (chunk: string) => {
      raw += chunk;
    });
    req.on("error", (err) => {
      done({ ok: false, retryable: true, reason: err.message });
    });
    req.on("end", () => {
      if (status === 200) {
        done({ ok: true });

        return;
      }
      const reason = parseApnsReason(raw) ?? `HTTP ${status}`;
      if (status === 403 || status === 401) {
        // Stale or wrong provider token — re-sign before the next attempt.
        resetApnsToken();
      }
      done({
        ok: false,
        // 410 = token no longer valid for this topic; 400/BadDeviceToken is the
        // same story with a different code. Neither is worth retrying.
        retryable: status >= 500 || status === 429,
        reason,
      });
    });
    req.end(body);
  });
}

function parseApnsReason(raw: string): string | null {
  if (!raw) {
    return null;
  }
  try {
    return (JSON.parse(raw) as { reason?: string }).reason ?? null;
  } catch {
    return null;
  }
}

/** Reasons that mean "this token is dead — forget it". */
export function isApnsTokenDead(reason: string): boolean {
  return (
    reason === "Unregistered" ||
    reason === "BadDeviceToken" ||
    reason === "DeviceTokenNotForTopic" ||
    reason === "HTTP 410"
  );
}
