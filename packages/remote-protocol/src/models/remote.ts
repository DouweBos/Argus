import { z } from "zod";
import { CAPABILITIES } from "../capabilities";
import { HuddleChatMessage, HuddleGuestState } from "../huddle";
import { RemoteEndpoint } from "../models";

// --- Paired devices ---------------------------------------------------------

/** A device's push registration, handed over the gateway after pairing. */
export const DevicePushToken = z.object({
  service: z.enum(["apns", "fcm", "webpush"]),
  /** Native device token, or the Web Push endpoint URL for "webpush". */
  token: z.string(),
  /** APNs only — which Apple environment minted the token. */
  environment: z.enum(["production", "sandbox"]).optional(),
  /** Web Push only — the subscription's encryption keys (base64url). */
  keys: z.object({ auth: z.string(), p256dh: z.string() }).optional(),
  /**
   * APNs/FCM via the relay: the 32-byte AES key this device minted, base64.
   * Notifications are sealed with it so the relay only ever sees ciphertext.
   */
  push_key: z.string().optional(),
  /** The 32-byte HMAC key the device registered with the relay, base64. */
  auth_key: z.string().optional(),
  updated_at: z.number(),
});
export type DevicePushToken = z.infer<typeof DevicePushToken>;

/**
 * One entry in the host's paired-device list. Distinct from the wire's
 * `RemoteDevice` (a simulator/emulator a client can drive).
 */
export const PairedDevice = z.object({
  device_id: z.string(),
  label: z.string(),
  /** Pinned client static X25519 public key, base64. Handshake identity. */
  dev_static_pub: z.string(),
  capabilities: z.array(z.enum(CAPABILITIES)),
  created_at: z.number(),
  last_seen: z.number().nullable(),
  /** Present once the phone has registered for background push. */
  push: DevicePushToken.nullish(),
  /** QR pairing (absent on older records), or materialized from the account log. */
  source: z.enum(["account", "pairing"]).optional(),
});
export type PairedDevice = z.infer<typeof PairedDevice>;

// --- Status and routes ------------------------------------------------------

export const RemoteTunnelStatus = z.enum([
  "error",
  "running",
  "starting",
  "stopped",
]);
export type RemoteTunnelStatus = z.infer<typeof RemoteTunnelStatus>;

/**
 * A tunnel an earlier version let the user configure. It keeps running on a
 * computer that has nothing to replace it yet, and is retired once the managed
 * tunnel is up.
 */
export const LegacyTunnelKind = z.enum([
  "cloudflare_quick",
  "cloudflare_token",
  "tailscale_funnel",
]);
export type LegacyTunnelKind = z.infer<typeof LegacyTunnelKind>;

export const LegacyTunnelState = z.object({
  kind: LegacyTunnelKind,
  status: RemoteTunnelStatus,
  /** Public `wss://` URL once known, else null. */
  publicUrl: z.string().nullable(),
  error: z.string().nullable(),
});
export type LegacyTunnelState = z.infer<typeof LegacyTunnelState>;

export const ManagedTunnelPhase = z.enum([
  /** Not wanted right now; `reason` says why. */
  "off",
  /** The account service has no tunnels to give out. */
  "unavailable",
  "provisioning",
  "installing",
  "starting",
  "running",
  "error",
]);
export type ManagedTunnelPhase = z.infer<typeof ManagedTunnelPhase>;

export const ManagedTunnelOffReason = z.enum([
  "not_linked",
  "account_paused",
  "turned_off",
  "remote_off",
]);
export type ManagedTunnelOffReason = z.infer<typeof ManagedTunnelOffReason>;

/** The account-managed Cloudflare tunnel: the route in from anywhere. */
export const ManagedTunnelState = z.object({
  phase: ManagedTunnelPhase,
  reason: ManagedTunnelOffReason.nullable(),
  /** `wss://argus-….houwert.dev` once known. */
  url: z.string().nullable(),
  error: z.string().nullable(),
});
export type ManagedTunnelState = z.infer<typeof ManagedTunnelState>;

/** What an outside MCP client may do: read only, supervised or full access. */
export const McpAccess = z.enum(["monitor", "control", "admin"]);
export type McpAccess = z.infer<typeof McpAccess>;

/** An MCP client outside Argus that signed in over OAuth. */
export const McpClientGrant = z.object({
  grantId: z.string(),
  clientName: z.string(),
  access: McpAccess,
  createdAt: z.number(),
  lastUsedAt: z.number().nullable(),
  connected: z.boolean(),
});
export type McpClientGrant = z.infer<typeof McpClientGrant>;

/** A sign-in waiting for the user to approve it on this computer. */
export const McpAccessRequest = z.object({
  requestId: z.string(),
  clientName: z.string(),
  requestedAccess: McpAccess.nullable(),
  /** Also shown on the client's browser page, so the right one is approved. */
  matchCode: z.string(),
  redirectHost: z.string(),
  createdAt: z.number(),
});
export type McpAccessRequest = z.infer<typeof McpAccessRequest>;

export const RemoteStatus = z.object({
  enabled: z.boolean(),
  /** Every address a phone could use right now, best first. */
  endpoints: z.array(RemoteEndpoint),
  publicUrl: z.string().nullable(),
  lanUrl: z.string().nullable(),
  /** This computer's tailnet address, when Tailscale is connected. */
  tailscaleUrl: z.string().nullable(),
  managedTunnel: ManagedTunnelState,
  /** Tunnels configured by an earlier version, still running until replaced. */
  legacyTunnels: z.array(LegacyTunnelState),
  /** Mirror notifications to devices even while the desktop window is focused. */
  notifyWhenFocused: z.boolean(),
  /**
   * Serve the web client to browsers connecting straight over the local
   * network. Absent from an older host.
   */
  lanWebClient: z.boolean().optional(),
  /** Serve Argus's MCP server to outside clients over OAuth. Absent from an older host. */
  mcpClients: z.boolean().optional(),
  mcpGrants: z.array(McpClientGrant).optional(),
  mcpRequests: z.array(McpAccessRequest).optional(),
  /** Where an outside client adds Argus's MCP server, best first; loopback last. */
  mcpUrls: z.array(z.string()).optional(),
  devices: z.array(PairedDevice),
  /** Device IDs with a live connection right now. */
  connectedDeviceIds: z.array(z.string()),
});
export type RemoteStatus = z.infer<typeof RemoteStatus>;

/** A partial update to how the host is reachable; absent keys are untouched. */
export const RemoteConfigPatch = z.object({
  enabled: z.boolean().optional(),
  notifyWhenFocused: z.boolean().optional(),
  lanWebClient: z.boolean().optional(),
  mcpClients: z.boolean().optional(),
  /** Stop and forget every tunnel an earlier version configured. */
  retireLegacyTunnels: z.boolean().optional(),
});
export type RemoteConfigPatch = z.infer<typeof RemoteConfigPatch>;

// --- Push -------------------------------------------------------------------

/** Push settings — presence flags only, never the keys. */
export const RemotePushConfig = z.object({
  enabled: z.boolean(),
  webPushConfigured: z.boolean(),
  /** VAPID contact claim sent to the browser's push service. */
  vapidSubject: z.string(),
  /** Where phones register their relay auth key. */
  relayUrl: z.string(),
});
export type RemotePushConfig = z.infer<typeof RemotePushConfig>;

export const RemotePushConfigPatch = z.object({
  enabled: z.boolean().optional(),
  /** `mailto:`/`https:` contact the browser's push service can reach you at. */
  vapidSubject: z.string().optional(),
});
export type RemotePushConfigPatch = z.infer<typeof RemotePushConfigPatch>;

export const RemotePushTestResult = z.object({
  delivered: z.boolean(),
  reason: z.string().optional(),
});
export type RemotePushTestResult = z.infer<typeof RemotePushTestResult>;

// --- Pairing ----------------------------------------------------------------

export const RemotePairingStart = z.object({
  /** JSON payload to render as a QR code. */
  qrPayload: z.string(),
  /** Same payload, base64url — a copy-paste fallback when a camera can't scan. */
  pairingCode: z.string(),
});
export type RemotePairingStart = z.infer<typeof RemotePairingStart>;

// --- Huddles ----------------------------------------------------------------

export const ShareErrorKind = z.enum([
  "cloudflared-missing",
  "quick-tunnel-failed",
  "tunnel-unreachable",
  "unknown",
]);
export type ShareErrorKind = z.infer<typeof ShareErrorKind>;

/** Why a share failed, structured so the dialog can walk the user through it. */
export const ShareErrorPayload = z.object({
  __shareError: z.literal(true),
  kind: ShareErrorKind,
  /** One line: what didn't happen. */
  message: z.string(),
  /** Why, in plain language. */
  explanation: z.string(),
  /** What to do, in order. */
  steps: z.array(z.string()),
  /** Shell command that fixes it, if one does. */
  command: z.string().optional(),
  /** The other way out, when there is one. */
  alternative: z.string().optional(),
  /** Raw failure text, for the collapsed details. */
  detail: z.string().optional(),
});
export type ShareErrorPayload = z.infer<typeof ShareErrorPayload>;

/** Whether sharing can mint a link, and what's in the way when it can't. */
export const ShareReadiness = z.object({
  ready: z.boolean(),
  /** Why not, in the same shape a failed start would throw. */
  blocker: ShareErrorPayload.optional(),
});
export type ShareReadiness = z.infer<typeof ShareReadiness>;

/** Schema for the host-side `HuddleGuest` view in `huddle.ts`. */
export const HuddleGuestModel = z.object({
  member_id: z.string(),
  dev_static_pub: z.string(),
  client_id: z.string().nullable(),
  label: z.string(),
  state: HuddleGuestState,
  joined_at: z.number(),
  approved_at: z.number().nullable(),
  connected: z.boolean(),
  typing: z.boolean(),
});

/** Schema for the host-side `HuddleRoom` view in `huddle.ts`. */
export const HuddleRoomModel = z.object({
  id: z.string(),
  token: z.string(),
  agent_id: z.string(),
  device_key: z.string(),
  url: z.string().nullable(),
  created_at: z.number(),
  expires_at: z.number(),
  guests: z.array(HuddleGuestModel),
  host_typing: z.boolean(),
  host_label: z.string(),
  chat: z.array(HuddleChatMessage),
});
