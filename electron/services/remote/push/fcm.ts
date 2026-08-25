/**
 * Direct FCM (HTTP v1) provider. The desktop mints its own OAuth token from a
 * Firebase service account, so Android push — like APNs — goes straight from
 * this machine to Google with no Argus-operated server in between.
 */

import type { PushConfig } from "../deviceStore";
import type { PushOutcome } from "./apns";
import { createPrivateKey, sign as cryptoSign } from "node:crypto";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri?: string;
}

export interface FcmPayload {
  title: string;
  body: string;
  data: Record<string, string>;
  /** Android notification tag — a newer notification replaces an older one. */
  collapseId?: string;
}

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
/** Google issues 1h tokens; refresh early so a send never races expiry. */
const TOKEN_TTL_MS = 50 * 60 * 1000;

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function parseServiceAccount(raw: string): ServiceAccount | null {
  if (!raw.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
      return null;
    }

    return parsed as ServiceAccount;
  } catch {
    return null;
  }
}

export function isFcmConfigured(config: PushConfig): boolean {
  return parseServiceAccount(config.fcm_service_account) !== null;
}

let cachedAccess: { value: string; email: string; expiresAt: number } | null =
  null;

/** Reset the cached OAuth token (used when credentials change). */
export function resetFcmToken(): void {
  cachedAccess = null;
}

async function accessToken(
  account: ServiceAccount,
  now: number,
): Promise<string> {
  if (
    cachedAccess &&
    cachedAccess.email === account.client_email &&
    cachedAccess.expiresAt > now
  ) {
    return cachedAccess.value;
  }

  const tokenUri = account.token_uri ?? DEFAULT_TOKEN_URI;
  const iat = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: SCOPE,
      aud: tokenUri,
      iat,
      exp: iat + 3600,
    }),
  );
  const signature = cryptoSign(
    "sha256",
    Buffer.from(`${header}.${claims}`),
    createPrivateKey({ key: account.private_key, format: "pem" }),
  );
  const assertion = `${header}.${claims}.${base64url(signature)}`;

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    throw new Error(`token exchange failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error("token exchange returned no access_token");
  }
  cachedAccess = {
    value: json.access_token,
    email: account.client_email,
    expiresAt: now + TOKEN_TTL_MS,
  };

  return json.access_token;
}

export async function sendFcm(
  config: PushConfig,
  deviceToken: string,
  payload: FcmPayload,
  now: number,
): Promise<PushOutcome> {
  const account = parseServiceAccount(config.fcm_service_account);
  if (!account) {
    return { ok: false, retryable: false, reason: "FCM is not configured" };
  }

  let token: string;
  try {
    token = await accessToken(account, now);
  } catch (err) {
    resetFcmToken();

    return { ok: false, retryable: true, reason: (err as Error).message };
  }

  let res: Response;
  try {
    res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: deviceToken,
            notification: { title: payload.title, body: payload.body },
            data: payload.data,
            android: {
              priority: "HIGH",
              ...(payload.collapseId
                ? { collapse_key: payload.collapseId.slice(0, 64) }
                : {}),
              notification: {
                ...(payload.collapseId ? { tag: payload.collapseId } : {}),
                default_sound: true,
              },
            },
          },
        }),
      },
    );
  } catch (err) {
    return { ok: false, retryable: true, reason: (err as Error).message };
  }

  if (res.ok) {
    return { ok: true };
  }
  const raw = await res.text().catch(() => "");
  const reason = parseFcmError(raw) ?? `HTTP ${res.status}`;
  if (res.status === 401 || res.status === 403) {
    resetFcmToken();
  }

  return {
    ok: false,
    retryable: res.status >= 500 || res.status === 429,
    reason,
  };
}

function parseFcmError(raw: string): string | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as {
      error?: { status?: string; message?: string };
    };

    return parsed.error?.status ?? parsed.error?.message ?? null;
  } catch {
    return null;
  }
}

/** Reasons that mean "this registration is dead — forget it". */
export function isFcmTokenDead(reason: string): boolean {
  return (
    reason === "UNREGISTERED" ||
    reason === "NOT_FOUND" ||
    reason === "INVALID_ARGUMENT" ||
    reason === "HTTP 404"
  );
}
