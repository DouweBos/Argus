/**
 * Signing in to an integration through the browser: authorization code with
 * PKCE against a registered OAuth app, answered on a loopback port. Tokens
 * refresh ahead of expiry so a long-lived host never notices.
 */

import type { IntegrationAccount, IntegrationId } from "@argus/remote-protocol";
import { randomBytes } from "node:crypto";
import { hostPlatform } from "@argus/host/platform";
import { pkcePair, startLoopback } from "../mcp/oauth";
import { loadIntegration, readSecret, saveIntegration } from "./credentials";

const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;
const REFRESH_MARGIN_MS = 60 * 1000;

interface OAuthApp {
  clientId: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  /** Registered redirects must match exactly, so the port is fixed. */
  port: number;
}

/** Argus's public Linear app. Public clients use PKCE, so there's no secret. */
const LINEAR_CLIENT_ID = "0e6aed28f0324b14b99789ba966b098f";

const APPS: Partial<Record<IntegrationId, OAuthApp>> = {
  linear: {
    clientId: process.env.ARGUS_LINEAR_CLIENT_ID ?? LINEAR_CLIENT_ID,
    authorizeUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token",
    scope: "read,write",
    port: 47_620,
  },
};

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms; null when the service didn't say. */
  expiresAt: number | null;
}

function app(id: IntegrationId): OAuthApp | null {
  const found = APPS[id];

  return found?.clientId ? found : null;
}

export function oauthAvailable(id: IntegrationId): boolean {
  return app(id) !== null;
}

async function tokenRequest(
  oauthApp: OAuthApp,
  body: Record<string, string>,
): Promise<OAuthTokens> {
  const res = await fetch(oauthApp.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: oauthApp.clientId, ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Token request failed (HTTP ${res.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
    );
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : null,
  };
}

let pendingCancel: (() => void) | null = null;

export function cancelOAuth(): void {
  pendingCancel?.();
}

/** Opens the browser and resolves once the user approved; throws a sentence otherwise. */
export async function signInWithOAuth(
  id: IntegrationId,
  accountFor: (accessToken: string) => Promise<IntegrationAccount>,
): Promise<void> {
  const oauthApp = app(id);
  if (!oauthApp) {
    throw "Browser sign-in isn't set up for this integration yet. Use a key instead.";
  }
  cancelOAuth();
  const state = randomBytes(16).toString("hex");
  const { verifier, challenge } = pkcePair();
  let loopback;
  try {
    loopback = await startLoopback(state, oauthApp.port);
  } catch {
    throw `Port ${oauthApp.port} is busy, so the sign-in can't come back to Argus. Close whatever uses it and try again.`;
  }
  const cancelled = new Promise<never>((_, reject) => {
    pendingCancel = () => reject(new Error("cancelled"));
    setTimeout(
      () => reject(new Error("timed out")),
      SIGN_IN_TIMEOUT_MS,
    ).unref();
  });
  try {
    const url = new URL(oauthApp.authorizeUrl);
    url.search = new URLSearchParams({
      client_id: oauthApp.clientId,
      redirect_uri: loopback.redirectUri,
      response_type: "code",
      scope: oauthApp.scope,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "consent",
    }).toString();
    await hostPlatform().openExternal(url.toString());
    const code = await Promise.race([loopback.waitForCode(), cancelled]);
    const tokens = await tokenRequest(oauthApp, {
      grant_type: "authorization_code",
      code,
      redirect_uri: loopback.redirectUri,
      code_verifier: verifier,
    });
    saveIntegration(id, {
      method: "oauth",
      secret: JSON.stringify(tokens),
      account: await accountFor(tokens.accessToken),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw reason === "cancelled"
      ? "Sign-in cancelled."
      : `Sign-in failed: ${reason}`;
  } finally {
    pendingCancel = null;
    loopback.close();
  }
}

export function parseTokens(secret: string): OAuthTokens | null {
  try {
    const parsed = JSON.parse(secret) as OAuthTokens;

    return typeof parsed.accessToken === "string" ? parsed : null;
  } catch {
    return null;
  }
}

const refreshing = new Map<IntegrationId, Promise<string | null>>();

/**
 * The access token, refreshed first when it's about to expire. Concurrent
 * callers share one refresh. Null when it can't be refreshed.
 */
export function freshAccessToken(id: IntegrationId): Promise<string | null> {
  const entry = loadIntegration(id);
  const secret = readSecret(id);
  const tokens = secret ? parseTokens(secret) : null;
  if (!entry || !tokens) {
    return Promise.resolve(null);
  }
  if (!tokens.expiresAt || tokens.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return Promise.resolve(tokens.accessToken);
  }
  const oauthApp = app(id);
  if (!oauthApp || !tokens.refreshToken) {
    return Promise.resolve(null);
  }
  const inFlight = refreshing.get(id);
  if (inFlight) {
    return inFlight;
  }
  const refresh = tokenRequest(oauthApp, {
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  })
    .then((next) => {
      const merged = {
        ...next,
        refreshToken: next.refreshToken ?? tokens.refreshToken,
      };
      saveIntegration(id, {
        method: "oauth",
        secret: JSON.stringify(merged),
        account: entry.account,
      });

      return merged.accessToken;
    })
    .catch(() => null)
    .finally(() => refreshing.delete(id));
  refreshing.set(id, refresh);

  return refresh;
}
