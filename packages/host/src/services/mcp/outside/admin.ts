/** The console's side of outside MCP clients: approve, deny, revoke, re-grant. */

import { capture } from "../../telemetry/telemetry";
import {
  decideRequest,
  isGrantLive,
  listGrants,
  pendingRequests,
  revokeGrant,
  setGrantAccess,
  type McpAccess,
} from "./store";

export interface McpClientGrantView {
  grantId: string;
  clientName: string;
  access: McpAccess;
  createdAt: number;
  lastUsedAt: number | null;
  connected: boolean;
}

export interface McpAccessRequestView {
  requestId: string;
  clientName: string;
  requestedAccess: McpAccess | null;
  matchCode: string;
  /** Where the sign-in returns to, so a surprising destination stands out. */
  redirectHost: string;
  createdAt: number;
}

export function mcpGrantViews(): McpClientGrantView[] {
  return listGrants().map((g) => ({
    grantId: g.grant_id,
    clientName: g.client_name,
    access: g.access,
    createdAt: g.created_at,
    lastUsedAt: g.last_used_at,
    connected: isGrantLive(g.grant_id),
  }));
}

export function mcpRequestViews(): McpAccessRequestView[] {
  return pendingRequests().map((r) => ({
    requestId: r.request_id,
    clientName: r.client_name,
    requestedAccess: r.requested_access,
    matchCode: r.match_code,
    redirectHost: new URL(r.redirect_uri).host,
    createdAt: r.created_at,
  }));
}

export function decideMcpRequest(
  requestId: string,
  approve: boolean,
  access: McpAccess,
): void {
  try {
    decideRequest(requestId, approve ? access : null);
  } catch (e) {
    throw (e as Error).message;
  }
  capture("mcp_access_changed", {
    action: approve ? "approved" : "denied",
    access,
  });
}

export function revokeMcpGrant(grantId: string): void {
  const grant = listGrants().find((g) => g.grant_id === grantId);
  if (!grant || !revokeGrant(grantId)) {
    throw "That client is no longer connected.";
  }
  capture("mcp_access_changed", { action: "revoked", access: grant.access });
}

export function setMcpGrantAccess(grantId: string, access: McpAccess): void {
  try {
    setGrantAccess(grantId, access);
  } catch (e) {
    throw (e as Error).message;
  }
  capture("mcp_access_changed", { action: "changed", access });
}
