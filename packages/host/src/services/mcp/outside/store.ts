/**
 * MCP clients outside Argus that signed in over OAuth: their registrations,
 * grants and tokens, plus the access requests waiting on the console.
 *
 * Only SHA-256 hashes of tokens and codes are kept, so the file (mode 0600,
 * `$ARGUS_HOME/mcp-clients.json`) holds nothing a reader could replay. Access
 * tokens live in memory only: after a restart clients refresh.
 *
 * Leaf-level (node builtins + `argusHome`) so the remote service can follow it
 * without an import cycle.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { argusHomeDir } from "../../../lib/argusHome";

/** The device grants, reused: read only, supervised, full access. */
export type McpAccess = "admin" | "control" | "monitor";
export const MCP_ACCESS: McpAccess[] = ["monitor", "control", "admin"];

export interface OAuthClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  created_at: number;
}

export interface McpGrant {
  grant_id: string;
  client_id: string;
  client_name: string;
  access: McpAccess;
  created_at: number;
  last_used_at: number | null;
  refresh_hash: string;
  refresh_expires_at: number;
}

export interface AccessRequest {
  request_id: string;
  client_id: string;
  client_name: string;
  redirect_uri: string;
  state: string | null;
  code_challenge: string;
  requested_access: McpAccess | null;
  /** Shown on the browser page and in Argus, so the right request is approved. */
  match_code: string;
  created_at: number;
  decision: "denied" | { access: McpAccess } | null;
}

interface AuthCode {
  client_id: string;
  client_name: string;
  redirect_uri: string;
  code_challenge: string;
  access: McpAccess;
  expires_at: number;
}

interface FileShape {
  clients: Record<string, OAuthClient>;
  grants: Record<string, McpGrant>;
}

export const ACCESS_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TTL_MS = 60 * 24 * 60 * 60 * 1000;
export const REQUEST_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 60 * 1000;
const MAX_CLIENTS = 200;
const MAX_PENDING = 5;

export const hashToken = (token: string): string =>
  crypto.createHash("sha256").update(token).digest("hex");

export const newSecret = (prefix: string): string =>
  `${prefix}${crypto.randomBytes(32).toString("base64url")}`;

function filePath(): string {
  return path.join(argusHomeDir(), "mcp-clients.json");
}

let cache: FileShape | null = null;
const accessTokens = new Map<
  string,
  { grant_id: string; expires_at: number }
>();
const codes = new Map<string, AuthCode>();
const requests = new Map<string, AccessRequest>();
const listeners = new Set<() => void>();

function load(): FileShape {
  if (cache) {
    return cache;
  }
  try {
    const parsed = JSON.parse(
      fs.readFileSync(filePath(), "utf-8"),
    ) as FileShape;
    cache = { clients: parsed.clients ?? {}, grants: parsed.grants ?? {} };
  } catch {
    cache = { clients: {}, grants: {} };
  }

  return cache;
}

function save(): void {
  const file = filePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(load()), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function changed(): void {
  for (const cb of listeners) {
    cb();
  }
}

/** Grants or requests changed; the remote status follows it. */
export function onOutsideMcpChanged(cb: () => void): () => void {
  listeners.add(cb);

  return () => listeners.delete(cb);
}

// --- Clients (RFC 7591) -------------------------------------------------------

export function registerClient(
  clientName: string,
  redirectUris: string[],
  now = Date.now(),
): OAuthClient {
  const state = load();
  const ids = Object.keys(state.clients);
  if (ids.length >= MAX_CLIENTS) {
    // Registration is unauthenticated: evict the oldest client nobody approved.
    const granted = new Set(
      Object.values(state.grants).map((g) => g.client_id),
    );
    const oldest = ids
      .filter((id) => !granted.has(id))
      .sort(
        (a, b) => state.clients[a].created_at - state.clients[b].created_at,
      )[0];
    if (!oldest) {
      throw new Error("too many registered clients");
    }
    delete state.clients[oldest];
  }
  const client: OAuthClient = {
    client_id: crypto.randomUUID(),
    client_name: clientName.slice(0, 80) || "MCP client",
    redirect_uris: redirectUris,
    created_at: now,
  };
  state.clients[client.client_id] = client;
  save();

  return client;
}

export function getClient(clientId: string): OAuthClient | null {
  return load().clients[clientId] ?? null;
}

// --- Access requests ----------------------------------------------------------

function prune(now: number): void {
  for (const [id, r] of requests) {
    if (now - r.created_at > REQUEST_TTL_MS) {
      requests.delete(id);
    }
  }
  for (const [hash, c] of codes) {
    if (c.expires_at < now) {
      codes.delete(hash);
    }
  }
}

export function createRequest(
  input: Omit<
    AccessRequest,
    "created_at" | "decision" | "match_code" | "request_id"
  >,
  now = Date.now(),
): AccessRequest {
  prune(now);
  const pending = [...requests.values()].filter((r) => r.decision === null);
  if (pending.length >= MAX_PENDING) {
    requests.delete(pending[0].request_id);
  }
  const request: AccessRequest = {
    ...input,
    request_id: crypto.randomBytes(24).toString("base64url"),
    match_code: String(crypto.randomInt(0, 1_000_000)).padStart(6, "0"),
    created_at: now,
    decision: null,
  };
  requests.set(request.request_id, request);
  changed();

  return request;
}

export function getRequest(
  requestId: string,
  now = Date.now(),
): AccessRequest | null {
  prune(now);

  return requests.get(requestId) ?? null;
}

export function pendingRequests(now = Date.now()): AccessRequest[] {
  prune(now);

  return [...requests.values()].filter((r) => r.decision === null);
}

export function decideRequest(
  requestId: string,
  access: McpAccess | null,
): AccessRequest {
  const request = getRequest(requestId);
  if (!request || request.decision !== null) {
    throw new Error("That request has expired or was already answered.");
  }
  request.decision = access ? { access } : "denied";
  changed();

  return request;
}

/** Called once the browser comes back for an approved request: one code, once. */
export function issueCode(
  request: AccessRequest,
  now = Date.now(),
): string | null {
  if (request.decision === null || request.decision === "denied") {
    return null;
  }
  requests.delete(request.request_id);
  const code = newSecret("argus_code_");
  codes.set(hashToken(code), {
    client_id: request.client_id,
    client_name: request.client_name,
    redirect_uri: request.redirect_uri,
    code_challenge: request.code_challenge,
    access: request.decision.access,
    expires_at: now + CODE_TTL_MS,
  });

  return code;
}

export function forgetRequest(requestId: string): void {
  requests.delete(requestId);
}

// --- Tokens -------------------------------------------------------------------

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  access: McpAccess;
}

function mint(grant: McpGrant, now: number): TokenPair {
  const access = newSecret("argus_at_");
  const refresh = newSecret("argus_rt_");
  accessTokens.set(hashToken(access), {
    grant_id: grant.grant_id,
    expires_at: now + ACCESS_TTL_MS,
  });
  grant.refresh_hash = hashToken(refresh);
  grant.refresh_expires_at = now + REFRESH_TTL_MS;
  save();

  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: ACCESS_TTL_MS / 1000,
    access: grant.access,
  };
}

const s256 = (verifier: string): string =>
  crypto.createHash("sha256").update(verifier).digest("base64url");

/** Redeem an authorization code (PKCE S256, single use) for a new grant. */
export function redeemCode(
  input: {
    code: string;
    client_id: string;
    redirect_uri: string;
    code_verifier: string;
  },
  now = Date.now(),
): TokenPair {
  const hash = hashToken(input.code);
  const code = codes.get(hash);
  codes.delete(hash);
  if (
    !code ||
    code.expires_at < now ||
    code.client_id !== input.client_id ||
    code.redirect_uri !== input.redirect_uri ||
    !safeEqual(s256(input.code_verifier), code.code_challenge)
  ) {
    throw new Error("invalid_grant");
  }
  const grant: McpGrant = {
    grant_id: crypto.randomUUID(),
    client_id: code.client_id,
    client_name: code.client_name,
    access: code.access,
    created_at: now,
    last_used_at: null,
    refresh_hash: "",
    refresh_expires_at: 0,
  };
  load().grants[grant.grant_id] = grant;
  const pair = mint(grant, now);
  changed();

  return pair;
}

/** Rotate a refresh token: the old one stops working. */
export function refreshTokens(
  input: { refresh_token: string; client_id: string },
  now = Date.now(),
): TokenPair {
  const hash = hashToken(input.refresh_token);
  const grant = Object.values(load().grants).find((g) =>
    safeEqual(g.refresh_hash, hash),
  );
  if (
    !grant ||
    grant.client_id !== input.client_id ||
    grant.refresh_expires_at < now
  ) {
    throw new Error("invalid_grant");
  }

  return mint(grant, now);
}

/** The grant behind a bearer token, or null when it's unknown, expired or revoked. */
export function grantForToken(
  token: string,
  now = Date.now(),
): McpGrant | null {
  const entry = accessTokens.get(hashToken(token));
  if (!entry) {
    return null;
  }
  const grant = load().grants[entry.grant_id];
  if (!grant || entry.expires_at < now) {
    accessTokens.delete(hashToken(token));

    return null;
  }
  if (grant.last_used_at === null || now - grant.last_used_at > 60_000) {
    grant.last_used_at = now;
    save();
  }

  return grant;
}

/** RFC 7009: revoking either token ends the whole grant. */
export function revokeToken(token: string): void {
  const hash = hashToken(token);
  const entry = accessTokens.get(hash);
  const grant =
    (entry && load().grants[entry.grant_id]) ||
    Object.values(load().grants).find((g) => safeEqual(g.refresh_hash, hash));
  if (grant) {
    revokeGrant(grant.grant_id);
  }
}

// --- Grants -------------------------------------------------------------------

export function listGrants(): McpGrant[] {
  return Object.values(load().grants).sort(
    (a, b) => b.created_at - a.created_at,
  );
}

export function getGrant(grantId: string): McpGrant | null {
  return load().grants[grantId] ?? null;
}

export function revokeGrant(grantId: string): boolean {
  const state = load();
  if (!state.grants[grantId]) {
    return false;
  }
  delete state.grants[grantId];
  for (const [hash, t] of accessTokens) {
    if (t.grant_id === grantId) {
      accessTokens.delete(hash);
    }
  }
  save();
  changed();

  return true;
}

export function setGrantAccess(grantId: string, access: McpAccess): McpGrant {
  const grant = load().grants[grantId];
  if (!grant) {
    throw new Error("That client is no longer connected.");
  }
  grant.access = access;
  save();
  changed();

  return grant;
}

let live = new Set<string>();

/** Grants with an open connection, reported by the endpoint. */
export function setLiveGrants(ids: Set<string>): void {
  const same = ids.size === live.size && [...ids].every((id) => live.has(id));
  live = ids;
  if (!same) {
    changed();
  }
}

export function isGrantLive(grantId: string): boolean {
  return live.has(grantId);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);

  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Tests only. */
export function resetOutsideMcpStore(): void {
  cache = null;
  accessTokens.clear();
  codes.clear();
  requests.clear();
}
