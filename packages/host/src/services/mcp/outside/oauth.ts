/**
 * The OAuth 2.1 authorization server outside MCP clients sign in with:
 * metadata (RFC 9728, RFC 8414), dynamic registration (RFC 7591), the
 * authorization code flow with PKCE S256 only, refresh rotation and
 * revocation (RFC 7009). Public clients; no client secrets.
 *
 * Approval never happens in the browser. The page only shows a match code and
 * waits; the user picks the access level and approves in Argus — the console —
 * so a stranger who reaches the tunnel URL gets nowhere on their own.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { hostPlatform } from "@argus/host/platform";
import { capture } from "../../telemetry/telemetry";
import {
  createRequest,
  forgetRequest,
  getClient,
  getRequest,
  issueCode,
  MCP_ACCESS,
  redeemCode,
  refreshTokens,
  registerClient,
  revokeToken,
  type McpAccess,
  type TokenPair,
} from "./store";

export const SCOPES = MCP_ACCESS.map((a) => `argus:${a}`);
const MAX_BODY = 64 * 1024;

export function json(res: ServerResponse, status: number, body: unknown): void {
  res
    .writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    })
    .end(JSON.stringify(body));
}

function oauthError(
  res: ServerResponse,
  status: number,
  error: string,
  description?: string,
): void {
  json(res, status, {
    error,
    ...(description ? { error_description: description } : {}),
  });
}

/** The URL this request reached us at — loopback, tailnet or a tunnel's https. */
export function baseUrl(req: IncomingMessage): string {
  const header = (v: string[] | string | undefined) =>
    Array.isArray(v) ? v[0] : v;
  const proto =
    header(req.headers["x-forwarded-proto"]) === "https" ? "https" : "http";
  const host =
    header(req.headers["x-forwarded-host"]) ?? req.headers.host ?? "127.0.0.1";

  return `${proto}://${host.split(",")[0].trim()}`;
}

async function readBody(req: IncomingMessage): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) {
      throw new Error("body too large");
    }
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  if ((req.headers["content-type"] ?? "").includes("application/json")) {
    const parsed = JSON.parse(raw || "{}") as Record<string, unknown>;

    return Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [
        k,
        typeof v === "string" ? v : JSON.stringify(v),
      ]),
    );
  }

  return Object.fromEntries(new URLSearchParams(raw));
}

// --- Metadata -----------------------------------------------------------------

export function protectedResourceMetadata(base: string): unknown {
  return {
    resource: `${base}/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    scopes_supported: SCOPES,
    resource_name: "Argus",
  };
}

export function authServerMetadata(base: string): unknown {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: SCOPES,
  };
}

// --- Registration -------------------------------------------------------------

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** https anywhere, or http on loopback (RFC 8252) — never a scheme a page could abuse. */
export function isAllowedRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) {
      return false;
    }

    return (
      u.protocol === "https:" ||
      (u.protocol === "http:" && LOOPBACK.has(u.hostname))
    );
  } catch {
    return false;
  }
}

/** Exact match, except a loopback redirect may change port (RFC 8252 §7.3). */
function redirectMatches(registered: string[], uri: string): boolean {
  if (registered.includes(uri)) {
    return true;
  }
  try {
    const u = new URL(uri);
    if (u.protocol !== "http:" || !LOOPBACK.has(u.hostname)) {
      return false;
    }

    return registered.some((r) => {
      const v = new URL(r);

      return (
        v.protocol === "http:" &&
        v.hostname === u.hostname &&
        v.pathname === u.pathname
      );
    });
  } catch {
    return false;
  }
}

async function handleRegister(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
    if (Buffer.concat(chunks).length > MAX_BODY) {
      return oauthError(res, 400, "invalid_client_metadata", "too large");
    }
  }
  let meta: {
    client_name?: unknown;
    redirect_uris?: unknown;
    token_endpoint_auth_method?: unknown;
  };
  try {
    meta = JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}");
  } catch {
    return oauthError(res, 400, "invalid_client_metadata");
  }
  const uris = Array.isArray(meta.redirect_uris)
    ? meta.redirect_uris.filter((u) => typeof u === "string")
    : [];
  if (uris.length === 0 || uris.length > 10 || !uris.every(isAllowedRedirect)) {
    return oauthError(
      res,
      400,
      "invalid_redirect_uri",
      "redirect URIs must be https or http on loopback",
    );
  }
  if (
    meta.token_endpoint_auth_method !== undefined &&
    meta.token_endpoint_auth_method !== "none"
  ) {
    return oauthError(
      res,
      400,
      "invalid_client_metadata",
      "only public clients (none) are supported",
    );
  }
  const client = registerClient(
    typeof meta.client_name === "string" ? meta.client_name : "MCP client",
    uris as string[],
  );
  json(res, 201, {
    client_id: client.client_id,
    client_id_issued_at: Math.floor(client.created_at / 1000),
    client_name: client.client_name,
    redirect_uris: client.redirect_uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
}

// --- Authorization ------------------------------------------------------------

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(
  res: ServerResponse,
  status: number,
  title: string,
  body: string,
  refreshUrl?: string,
): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  }).end(`<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refreshUrl ? `<meta http-equiv="refresh" content="2;url=${escape(refreshUrl)}">` : ""}
<title>${escape(title)}</title>
<style>body{font:16px -apple-system,system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color-scheme:light dark}
.code{font:600 2rem ui-monospace,monospace;letter-spacing:.2em}</style>
<h1>${escape(title)}</h1>
${body}`);
}

function accessFromScope(scope: string | null): McpAccess | null {
  const asked = (scope ?? "").split(/\s+/).filter((s) => SCOPES.includes(s));
  // The broadest one asked for is what the user is asked about.
  for (const a of [...MCP_ACCESS].reverse()) {
    if (asked.includes(`argus:${a}`)) {
      return a;
    }
  }

  return null;
}

function redirectWith(
  res: ServerResponse,
  uri: string,
  params: Record<string, string | null>,
): void {
  const target = new URL(uri);
  for (const [k, v] of Object.entries(params)) {
    if (v !== null) {
      target.searchParams.set(k, v);
    }
  }
  res
    .writeHead(302, {
      location: target.toString(),
      "cache-control": "no-store",
    })
    .end();
}

let lastBanner = 0;

function handleAuthorize(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): void {
  const q = url.searchParams;
  const client = getClient(q.get("client_id") ?? "");
  const redirectUri = q.get("redirect_uri") ?? "";
  // Without a trusted client + redirect there is nowhere safe to send an error.
  if (!client || !redirectMatches(client.redirect_uris, redirectUri)) {
    return page(
      res,
      400,
      "Unknown client",
      "<p>This sign-in link isn't valid. Start again from your MCP client.</p>",
    );
  }
  const state = q.get("state");
  const challenge = q.get("code_challenge") ?? "";
  if (q.get("response_type") !== "code") {
    return redirectWith(res, redirectUri, {
      error: "unsupported_response_type",
      state,
    });
  }
  if (
    q.get("code_challenge_method") !== "S256" ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)
  ) {
    return redirectWith(res, redirectUri, {
      error: "invalid_request",
      error_description: "PKCE with S256 is required",
      state,
    });
  }
  const request = createRequest({
    client_id: client.client_id,
    client_name: client.client_name,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    requested_access: accessFromScope(q.get("scope")),
  });
  capture("mcp_access_changed", {
    action: "requested",
    access: request.requested_access ?? "control",
  });
  if (Date.now() - lastBanner > 30_000) {
    lastBanner = Date.now();
    hostPlatform().notify({
      title: "An MCP client wants to use Argus",
      body: `${client.client_name} is asking for access. Approve or deny it in Settings → Remote Access.`,
      onClick: () => hostPlatform().focusUi(),
    });
  }
  waitPage(res, request.request_id, baseUrl(req));
}

function waitPage(res: ServerResponse, requestId: string, root: string): void {
  const request = getRequest(requestId);
  if (!request) {
    return page(
      res,
      410,
      "Request expired",
      "<p>Nobody answered in time. Start again from your MCP client.</p>",
    );
  }
  page(
    res,
    200,
    "Approve in Argus",
    `<p><b>${escape(request.client_name)}</b> wants to use Argus on this computer.</p>
<p>Open Argus, go to <b>Settings → Remote Access</b>, check the request shows this code, then choose what it may do and approve it.</p>
<p class="code">${escape(request.match_code)}</p>
<p>This page continues on its own.</p>`,
    `${root}/oauth/authorize/wait?request=${encodeURIComponent(requestId)}`,
  );
}

function handleWait(req: IncomingMessage, res: ServerResponse, url: URL): void {
  const request = getRequest(url.searchParams.get("request") ?? "");
  if (!request) {
    return page(
      res,
      410,
      "Request expired",
      "<p>Nobody answered in time. Start again from your MCP client.</p>",
    );
  }
  if (request.decision === "denied") {
    forgetRequest(request.request_id);

    return redirectWith(res, request.redirect_uri, {
      error: "access_denied",
      state: request.state,
      iss: baseUrl(req),
    });
  }
  const code = issueCode(request);
  if (code) {
    return redirectWith(res, request.redirect_uri, {
      code,
      state: request.state,
      iss: baseUrl(req),
    });
  }
  waitPage(res, request.request_id, baseUrl(req));
}

// --- Token and revocation -----------------------------------------------------

function tokenResponse(res: ServerResponse, pair: TokenPair): void {
  json(res, 200, {
    access_token: pair.access_token,
    token_type: "Bearer",
    expires_in: pair.expires_in,
    refresh_token: pair.refresh_token,
    scope: `argus:${pair.access}`,
  });
}

async function handleToken(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: Record<string, string>;
  try {
    body = await readBody(req);
  } catch {
    return oauthError(res, 400, "invalid_request");
  }
  const clientId = body.client_id ?? "";
  if (!getClient(clientId)) {
    return oauthError(res, 401, "invalid_client");
  }
  try {
    if (body.grant_type === "authorization_code") {
      if (!body.code || !body.code_verifier || !body.redirect_uri) {
        return oauthError(res, 400, "invalid_request");
      }
      const pair = redeemCode({
        code: body.code,
        client_id: clientId,
        redirect_uri: body.redirect_uri,
        code_verifier: body.code_verifier,
      });

      return tokenResponse(res, pair);
    }
    if (body.grant_type === "refresh_token" && body.refresh_token) {
      return tokenResponse(
        res,
        refreshTokens({
          refresh_token: body.refresh_token,
          client_id: clientId,
        }),
      );
    }

    return oauthError(res, 400, "unsupported_grant_type");
  } catch {
    return oauthError(res, 400, "invalid_grant");
  }
}

async function handleRevoke(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const body = await readBody(req);
    if (body.token) {
      revokeToken(body.token);
    }
  } catch {
    // RFC 7009: answer 200 regardless.
  }
  res.writeHead(200, { "cache-control": "no-store" }).end();
}

/** True when the route was an OAuth one and has been answered. */
export async function handleOAuthRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const route = url.pathname;
  const get = req.method === "GET";
  const post = req.method === "POST";
  if (
    get &&
    (route === "/.well-known/oauth-protected-resource" ||
      route === "/.well-known/oauth-protected-resource/mcp")
  ) {
    json(res, 200, protectedResourceMetadata(baseUrl(req)));
  } else if (
    get &&
    (route === "/.well-known/oauth-authorization-server" ||
      route === "/.well-known/oauth-authorization-server/mcp")
  ) {
    json(res, 200, authServerMetadata(baseUrl(req)));
  } else if (post && route === "/oauth/register") {
    await handleRegister(req, res);
  } else if (get && route === "/oauth/authorize") {
    handleAuthorize(req, res, url);
  } else if (get && route === "/oauth/authorize/wait") {
    handleWait(req, res, url);
  } else if (post && route === "/oauth/token") {
    await handleToken(req, res);
  } else if (post && route === "/oauth/revoke") {
    await handleRevoke(req, res);
  } else {
    return false;
  }

  return true;
}
