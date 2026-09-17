/**
 * OAuth 2.1 client for MCP HTTP servers.
 *
 * Implements the flow the MCP spec mandates: discover protected-resource
 * metadata (RFC 9728) → discover authorization-server metadata (RFC 8414)
 * → dynamic client registration (RFC 7591) → authorization code with PKCE
 * → token exchange, with `resource` binding (RFC 8707).
 *
 * Tokens are persisted via `oauthStore.ts`. Header injection happens in
 * `userConfig.ts` so spawned agents inherit the bearer transparently.
 */

import { shell } from "electron";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { warn } from "../../../app/lib/logger";
import {
  canonicalResource,
  deleteToken,
  loadToken,
  saveToken,
  type StoredMcpToken,
} from "./oauthStore";

const REQUEST_TIMEOUT_MS = 10_000;
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
/**
 * Client identity sent during discovery and dynamic registration. The token
 * is consumed by the Claude Code CLI Argus spawns, and providers that gate
 * registration (Figma 403s unknown clients) only issue clients to names they
 * recognise — so we register as the CLI that actually calls the server.
 */
const CLIENT_NAME = "Claude Code";
const USER_AGENT = "claude-cli/1.0 (external, cli)";

/**
 * In-flight sign-in flows, keyed by canonical resource URL. Lets the
 * renderer cancel an attempt (e.g. when the user closes the browser
 * without completing) without waiting for the full auth timeout.
 */
const pendingFlows = new Map<string, () => void>();

export function cancelAuthentication(resourceUrl: string): boolean {
  const key = canonicalResource(resourceUrl);
  const cancel = pendingFlows.get(key);
  if (!cancel) {
    return false;
  }
  cancel();

  return true;
}

interface ProtectedResourceMetadata {
  resource?: string;
  authorization_servers?: string[];
  scopes_supported?: string[];
}

interface AuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
  grant_types_supported?: string[];
}

interface RegistrationResponse {
  client_id: string;
  client_secret?: string;
  registration_client_uri?: string;
  registration_access_token?: string;
  /** How the issued client must authenticate at the token endpoint. */
  token_endpoint_auth_method?: string;
}

/**
 * Credentials for the token endpoint: HTTP Basic when the client was issued
 * as `client_secret_basic` (Figma), form fields otherwise.
 */
function applyClientAuth(
  body: URLSearchParams,
  headers: Record<string, string>,
  client: { id: string; secret?: string; authMethod?: string },
): void {
  if (client.secret && client.authMethod === "client_secret_basic") {
    // RFC 6749 §2.3: Basic-authenticating clients must not also put
    // client_id in the body — Linear rejects that as multiple auth methods.
    const basic = Buffer.from(
      `${encodeURIComponent(client.id)}:${encodeURIComponent(client.secret)}`,
    ).toString("base64");
    headers.authorization = `Basic ${basic}`;

    return;
  }
  body.set("client_id", client.id);
  if (client.secret) {
    body.set("client_secret", client.secret);
  }
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        accept: "application/json",
        "user-agent": USER_AGENT,
        ...(init?.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `HTTP ${res.status} ${res.statusText} from ${url}${body ? ` — ${body.slice(0, 400)}` : ""}`,
      );
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Discover the OAuth authorization server for an MCP resource. Tries the
 * explicit `resource_metadata` URL first (when one was given), then falls
 * back to RFC 9728's `/.well-known/oauth-protected-resource` lookup at the
 * resource's origin.
 */
async function discoverAuthServer(
  resourceUrl: string,
  resourceMetadataUrl: string | null,
): Promise<{ resource: string; authServer: AuthServerMetadata }> {
  const candidates: string[] = [];
  if (resourceMetadataUrl) {
    candidates.push(resourceMetadataUrl);
  }
  try {
    const u = new URL(resourceUrl);
    candidates.push(`${u.origin}/.well-known/oauth-protected-resource`);
  } catch {
    // resourceUrl wasn't parseable; nothing to add.
  }

  let resourceMeta: ProtectedResourceMetadata | null = null;
  let lastErr: Error | null = null;
  for (const url of candidates) {
    try {
      resourceMeta = await fetchJson<ProtectedResourceMetadata>(url);
      break;
    } catch (err) {
      lastErr = err as Error;
    }
  }
  if (!resourceMeta) {
    throw new Error(
      `could not load protected-resource metadata: ${lastErr?.message ?? "no candidates"}`,
    );
  }

  const authServers = resourceMeta.authorization_servers ?? [];
  if (authServers.length === 0) {
    throw new Error(
      "protected-resource metadata listed no authorization_servers",
    );
  }
  const issuer = authServers[0];

  const wellKnownUrls = [
    `${issuer.replace(/\/$/, "")}/.well-known/oauth-authorization-server`,
    `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
  ];
  let authServer: AuthServerMetadata | null = null;
  for (const url of wellKnownUrls) {
    try {
      authServer = await fetchJson<AuthServerMetadata>(url);
      break;
    } catch (err) {
      lastErr = err as Error;
    }
  }
  if (!authServer) {
    throw new Error(
      `could not load authorization-server metadata: ${lastErr?.message ?? ""}`,
    );
  }

  return {
    resource: resourceMeta.resource ?? canonicalResource(resourceUrl),
    authServer,
  };
}

async function registerClient(
  authServer: AuthServerMetadata,
  redirectUri: string,
): Promise<RegistrationResponse> {
  if (!authServer.registration_endpoint) {
    throw new Error(
      "authorization server does not support dynamic client registration; manual config not supported yet",
    );
  }

  // Per RFC 7591 §2 the only required field is `redirect_uris`. Some
  // servers (notably Figma) reject registrations that include extra
  // hints they don't expect, so keep this body minimal and only fall
  // back to the richer payload if the minimal one is rejected.
  const minimal = {
    client_name: CLIENT_NAME,
    redirect_uris: [redirectUri],
  };
  const detailed = {
    ...minimal,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "native",
  };

  const post = (payload: object) =>
    fetchJson<RegistrationResponse>(authServer.registration_endpoint!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

  try {
    return await post(minimal);
  } catch (err) {
    const msg = (err as Error).message;
    // 403 with no useful body means the auth server gates dynamic
    // registration — most commonly Figma. Retrying with a different
    // body won't help; raise a more actionable error instead.
    if (/HTTP 403/.test(msg)) {
      throw new Error(
        "this server requires a pre-registered OAuth client (not yet supported)",
      );
    }
    warn(
      `[mcp-oauth] minimal registration rejected, retrying with full payload: ${msg}`,
    );

    return post(detailed);
  }
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  return { verifier, challenge };
}

/**
 * Spin up a single-shot localhost HTTP listener that resolves once the
 * browser hits `/callback?code=…`. The listener closes itself afterwards.
 */
function startLoopback(state: string): Promise<{
  port: number;
  redirectUri: string;
  waitForCode: () => Promise<string>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    let resolveCode: (code: string) => void;
    let rejectCode: (err: Error) => void;
    const codePromise = new Promise<string>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1`);
      if (url.pathname !== "/callback") {
        res.statusCode = 404;
        res.end("not found");

        return;
      }
      const incomingState = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      const errParam = url.searchParams.get("error");
      if (errParam) {
        res.statusCode = 400;
        res.end(`Authentication failed: ${errParam}. You can close this tab.`);
        rejectCode(new Error(`authorization error: ${errParam}`));

        return;
      }
      if (incomingState !== state) {
        res.statusCode = 400;
        res.end("state mismatch");
        rejectCode(new Error("state mismatch on callback"));

        return;
      }
      if (!code) {
        res.statusCode = 400;
        res.end("missing code");
        rejectCode(new Error("missing code on callback"));

        return;
      }
      res.statusCode = 200;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(
        "<!doctype html><meta charset=utf-8><title>Signed in</title><body style='font-family:system-ui;padding:40px;text-align:center;color:#333'><h2>Signed in successfully</h2><p>You can close this tab and return to Argus.</p>",
      );
      resolveCode(code);
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      resolve({
        port: addr.port,
        redirectUri: `http://127.0.0.1:${addr.port}/callback`,
        waitForCode: () => codePromise,
        close: () => {
          server.close();
        },
      });
    });
  });
}

async function exchangeCodeForToken(
  authServer: AuthServerMetadata,
  params: {
    code: string;
    codeVerifier: string;
    clientId: string;
    clientSecret?: string;
    clientAuthMethod?: string;
    redirectUri: string;
    resource: string;
  },
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
    resource: params.resource,
  });
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  applyClientAuth(body, headers, {
    id: params.clientId,
    secret: params.clientSecret,
    authMethod: params.clientAuthMethod,
  });
  const res = await fetch(authServer.token_endpoint, {
    method: "POST",
    headers,
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `token exchange failed: HTTP ${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}`,
    );
  }

  return (await res.json()) as TokenResponse;
}

/**
 * Drive the full OAuth flow for an MCP server. Resolves once a token has
 * been stored successfully; rejects on timeout, user cancel, or any
 * discovery / registration / exchange failure.
 */
export async function authenticate(opts: {
  serverUrl: string;
  resourceMetadataUrl?: string | null;
  scope?: string;
}): Promise<StoredMcpToken> {
  const { serverUrl } = opts;
  const { resource, authServer } = await discoverAuthServer(
    serverUrl,
    opts.resourceMetadataUrl ?? null,
  );

  const stateValue = randomBytes(16).toString("hex");
  const { verifier, challenge } = pkcePair();
  const lb = await startLoopback(stateValue);

  const cancelKey = canonicalResource(opts.serverUrl);
  let timeoutHandle: NodeJS.Timeout | null = null;
  let cancelReject: (() => void) | null = null;
  const cancelPromise = new Promise<never>((_, reject) => {
    cancelReject = () => reject(new Error("sign-in cancelled"));
  });
  pendingFlows.set(cancelKey, () => cancelReject?.());
  try {
    const registration = await registerClient(authServer, lb.redirectUri);

    const authUrl = new URL(authServer.authorization_endpoint);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", registration.client_id);
    authUrl.searchParams.set("redirect_uri", lb.redirectUri);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("state", stateValue);
    authUrl.searchParams.set("resource", resource);
    const scope =
      opts.scope ?? authServer.scopes_supported?.join(" ") ?? undefined;
    if (scope) {
      authUrl.searchParams.set("scope", scope);
    }

    await shell.openExternal(authUrl.toString());

    const code = await Promise.race([
      lb.waitForCode(),
      cancelPromise,
      new Promise<string>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error("authentication timed out after 5 minutes"));
        }, AUTH_TIMEOUT_MS);
      }),
    ]);

    const tokenRes = await exchangeCodeForToken(authServer, {
      code,
      codeVerifier: verifier,
      clientId: registration.client_id,
      clientSecret: registration.client_secret,
      clientAuthMethod: registration.token_endpoint_auth_method,
      redirectUri: lb.redirectUri,
      resource,
    });

    const stored: StoredMcpToken = {
      resource: canonicalResource(serverUrl),
      accessToken: tokenRes.access_token,
      refreshToken: tokenRes.refresh_token,
      expiresAt: tokenRes.expires_in
        ? Date.now() + tokenRes.expires_in * 1000
        : undefined,
      tokenEndpoint: authServer.token_endpoint,
      authorizationEndpoint: authServer.authorization_endpoint,
      clientId: registration.client_id,
      clientSecret: registration.client_secret,
      clientAuthMethod: registration.token_endpoint_auth_method,
      scope: tokenRes.scope ?? scope,
    };
    await saveToken(stored);

    return stored;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    pendingFlows.delete(cancelKey);
    lb.close();
  }
}

/**
 * Refresh an access token using the stored refresh token. Returns the
 * updated record (also persisted) or `null` if refresh isn't possible.
 */
export async function refresh(
  resourceUrl: string,
): Promise<StoredMcpToken | null> {
  const existing = await loadToken(resourceUrl);
  if (!existing?.refreshToken) {
    return null;
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: existing.refreshToken,
    resource: existing.resource,
  });
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  applyClientAuth(body, headers, {
    id: existing.clientId,
    secret: existing.clientSecret,
    authMethod: existing.clientAuthMethod,
  });
  try {
    const res = await fetch(existing.tokenEndpoint, {
      method: "POST",
      headers,
      body: body.toString(),
    });
    if (!res.ok) {
      warn(`[mcp-oauth] refresh failed: HTTP ${res.status}`);

      return null;
    }
    const data = (await res.json()) as TokenResponse;
    const updated: StoredMcpToken = {
      ...existing,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? existing.refreshToken,
      expiresAt: data.expires_in
        ? Date.now() + data.expires_in * 1000
        : undefined,
      scope: data.scope ?? existing.scope,
    };
    await saveToken(updated);

    return updated;
  } catch (err) {
    warn(`[mcp-oauth] refresh threw: ${(err as Error).message}`);

    return null;
  }
}

/**
 * Resolve a usable bearer token for the given resource, refreshing
 * eagerly when the cached token is within 60s of expiry. Returns `null`
 * when the user has never authenticated this server (or refresh failed
 * irrecoverably).
 */
export async function getActiveAccessToken(
  resourceUrl: string,
): Promise<string | null> {
  const existing = await loadToken(resourceUrl);
  if (!existing) {
    return null;
  }
  const fresh =
    existing.expiresAt && existing.expiresAt - Date.now() < 60_000
      ? await refresh(resourceUrl)
      : existing;

  return fresh?.accessToken ?? null;
}

export async function signOut(resourceUrl: string): Promise<void> {
  await deleteToken(resourceUrl);
}
