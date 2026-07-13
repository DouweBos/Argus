/**
 * Wire types the client speaks — a focused mirror of `@argus/remote-protocol`.
 * Kept as plain TS (no zod runtime needed on the client hot path) but matching
 * the desktop schemas exactly.
 */

export interface PairingPayload {
  v: 1;
  url: string; // public wss:// (Cloudflare tunnel)
  ds_pub: string; // base64url
  pairing_secret: string; // base64url
}

export interface PairingGrant {
  device_id: string;
  capabilities: string[];
}

export type RemoteMethod =
  | "projects.list"
  | "sessions.list"
  | "agents.list"
  | "agents.status"
  | "agents.vitals"
  | "agents.transcript"
  | "orgs.list"
  | "permission.respond";

export interface RemoteProject {
  repo_root: string;
  name: string;
}
export interface RemoteSession {
  id: string;
  repo_root: string;
  kind: string;
  branch: string;
  display_name?: string | null;
  status: string;
}
export interface RemoteAgentStatus {
  agent_id: string;
  session_id: string;
  status: string;
  model?: string | null;
  parent_agent_id?: string | null;
  created_at?: number;
}
export interface RemotePermissionRequest {
  agent_id: string;
  tool_use_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

// Envelopes -----------------------------------------------------------------

export interface RequestEnvelope {
  type: "req";
  seq: number;
  id: string;
  method: RemoteMethod;
  params: unknown;
}
export interface ResponseEnvelope {
  type: "res";
  seq: number;
  id: string;
  ok?: unknown;
  error?: { code: string; message: string };
}
export interface SubscribeEnvelope {
  type: "sub";
  seq: number;
  action: "subscribe" | "unsubscribe";
  agent_id: string;
}
export interface EventEnvelope {
  type: "evt";
  seq: number;
  event: string;
  agent_id?: string | null;
  payload: unknown;
}
export type Envelope =
  | RequestEnvelope
  | ResponseEnvelope
  | SubscribeEnvelope
  | EventEnvelope;
