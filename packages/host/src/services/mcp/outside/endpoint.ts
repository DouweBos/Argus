/**
 * Argus's MCP server for clients outside Argus, on the remote-access gateway:
 * `/mcp` behind OAuth bearer tokens, plus the OAuth routes. Each connection is
 * bound to the grant that opened it and only sees the tools that grant allows.
 *
 * Off unless the user turns on MCP clients under Remote Access. Refused to
 * direct local-network peers: that hop is plain http and would carry tokens in
 * the clear — loopback, the tailnet and https tunnels only.
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadAppSettings } from "../../appSettings/store";
import { isDirectLanPeer } from "../../remote/endpoints";
import { capture } from "../../telemetry/telemetry";
import { createMcpServer } from "../server";
import { baseUrl, handleOAuthRoute, json } from "./oauth";
import {
  getGrant,
  grantForToken,
  onOutsideMcpChanged,
  setLiveGrants,
} from "./store";
import { restrictToAccess } from "./tools";

interface OutsideSession {
  transport: StreamableHTTPServerTransport;
  grantId: string;
  access: string;
}

const sessions = new Map<string, OutsideSession>();
const MAX_SESSIONS = 32;

const OUTSIDE_PREFIXES = ["/mcp", "/oauth/", "/.well-known/oauth-"];

export function isOutsideMcpRoute(pathname: string): boolean {
  return OUTSIDE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

export function outsideMcpEnabled(): boolean {
  const settings = loadAppSettings();

  return Boolean(settings.remote_enabled && settings.remote_mcp_enabled);
}

/** Drop connections whose grant was revoked or changed level; clients reconnect. */
function closeStale(): void {
  for (const [id, s] of sessions) {
    const grant = getGrant(s.grantId);
    if (!grant || grant.access !== s.access) {
      sessions.delete(id);
      s.transport.close().catch(() => {});
    }
  }
  reportLive();
}
onOutsideMcpChanged(closeStale);

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) {
    return true;
  }
  try {
    return new URL(origin).host === new URL(baseUrl(req)).host;
  } catch {
    return false;
  }
}

function unauthorized(
  req: IncomingMessage,
  res: ServerResponse,
  error?: string,
): void {
  const meta = `${baseUrl(req)}/.well-known/oauth-protected-resource/mcp`;
  res
    .writeHead(401, {
      "content-type": "application/json",
      "www-authenticate": `Bearer resource_metadata="${meta}"${error ? `, error="${error}"` : ""}`,
    })
    .end(JSON.stringify({ error: error ?? "unauthorized" }));
}

async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const bearer = /^Bearer\s+(.+)$/i
    .exec(req.headers.authorization ?? "")?.[1]
    ?.trim();
  if (!bearer) {
    return unauthorized(req, res);
  }
  const grant = grantForToken(bearer);
  if (!grant) {
    return unauthorized(req, res, "invalid_token");
  }

  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const existing = sessionId ? sessions.get(sessionId) : undefined;
  if (existing && existing.grantId !== grant.grant_id) {
    return json(res, 404, { error: "session not found" });
  }
  if (existing) {
    await existing.transport.handleRequest(req, res);
    if (req.method === "DELETE") {
      sessions.delete(sessionId!);
      reportLive();
    }

    return;
  }
  if (sessionId || req.method !== "POST") {
    return json(res, 404, { error: "session not found" });
  }
  if (sessions.size >= MAX_SESSIONS) {
    return json(res, 503, { error: "too many connections" });
  }

  const server = createMcpServer(null);
  restrictToAccess(server, grant.access);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
  transport.onclose = () => {
    if (transport.sessionId) {
      sessions.delete(transport.sessionId);
      reportLive();
    }
  };
  await server.connect(transport);
  await transport.handleRequest(req, res);
  if (transport.sessionId) {
    sessions.set(transport.sessionId, {
      transport,
      grantId: grant.grant_id,
      access: grant.access,
    });
    reportLive();
    capture("mcp_client_connected", { via: "oauth", access: grant.access });
  }
}

function reportLive(): void {
  setLiveGrants(new Set([...sessions.values()].map((s) => s.grantId)));
}

/** The gateway's hook for `/mcp`, `/oauth/*` and the OAuth metadata. */
export async function handleOutsideMcp(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!outsideMcpEnabled()) {
    res.writeHead(404).end("Not Found");

    return;
  }
  if (isDirectLanPeer(req.socket.remoteAddress)) {
    return json(res, 403, {
      error:
        "MCP is only served over this computer's tunnel, the tailnet or localhost.",
    });
  }
  if (!sameOrigin(req)) {
    return json(res, 403, { error: "cross-origin requests not allowed" });
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname === "/mcp") {
      await handleMcp(req, res);
    } else if (!(await handleOAuthRoute(req, res, url))) {
      res.writeHead(404).end("Not Found");
    }
  } catch (e) {
    if (!res.headersSent) {
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

/** Tests only. */
export function closeOutsideSessions(): void {
  for (const s of sessions.values()) {
    s.transport.close().catch(() => {});
  }
  sessions.clear();
}
