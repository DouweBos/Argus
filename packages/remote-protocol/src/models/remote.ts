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
});
export type PairedDevice = z.infer<typeof PairedDevice>;

// --- Status and tunnels -----------------------------------------------------

export const RemoteTunnelProvider = z.enum(["cloudflare", "tailscale"]);
export type RemoteTunnelProvider = z.infer<typeof RemoteTunnelProvider>;

export const RemoteTunnelMode = z.enum(["quick", "token"]);
export type RemoteTunnelMode = z.infer<typeof RemoteTunnelMode>;

export const RemoteTunnelStatus = z.enum([
  "error",
  "running",
  "starting",
  "stopped",
]);
export type RemoteTunnelStatus = z.infer<typeof RemoteTunnelStatus>;

export const RemoteTunnelState = z.object({
  status: RemoteTunnelStatus,
  /** Public `wss://` URL once known, else null. */
  publicUrl: z.string().nullable(),
  error: z.string().nullable(),
  /**
   * Whether that URL was last seen to reach the gateway. `null` until probed —
   * a published URL is not a reachable one.
   */
  reachable: z.boolean().nullable(),
});
export type RemoteTunnelState = z.infer<typeof RemoteTunnelState>;

export const RemoteStatus = z.object({
  enabled: z.boolean(),
  /** Independently enabled tunnel providers. */
  tailscaleEnabled: z.boolean(),
  cloudflareEnabled: z.boolean(),
  /** Per-provider runtime state, keyed by provider. */
  tunnels: z.record(RemoteTunnelProvider, RemoteTunnelState),
  /** Every address a phone could use right now, best first. */
  endpoints: z.array(RemoteEndpoint),
  tunnelMode: RemoteTunnelMode,
  hasTunnelToken: z.boolean(),
  publicUrl: z.string().nullable(),
  lanWebEnabled: z.boolean(),
  lanUrl: z.string().nullable(),
  /** Mirror notifications to devices even while the desktop window is focused. */
  notifyWhenFocused: z.boolean(),
  devices: z.array(PairedDevice),
  /** Device IDs with a live connection right now. */
  connectedDeviceIds: z.array(z.string()),
});
export type RemoteStatus = z.infer<typeof RemoteStatus>;

/** A partial update to how the host is reachable; absent keys are untouched. */
export const RemoteConfigPatch = z.object({
  enabled: z.boolean().optional(),
  tailscaleEnabled: z.boolean().optional(),
  cloudflareEnabled: z.boolean().optional(),
  tunnelMode: RemoteTunnelMode.optional(),
  tunnelToken: z.string().optional(),
  publicUrl: z.string().optional(),
  lanWeb: z.boolean().optional(),
  notifyWhenFocused: z.boolean().optional(),
});
export type RemoteConfigPatch = z.infer<typeof RemoteConfigPatch>;

// --- Tailscale setup --------------------------------------------------------

export const TailscaleStepId = z.enum(["cli", "daemon", "funnel", "login"]);
export type TailscaleStepId = z.infer<typeof TailscaleStepId>;

export const TailscaleStepState = z.enum(["blocked", "fail", "ok"]);
export type TailscaleStepState = z.infer<typeof TailscaleStepState>;

/** A fix Argus can perform itself, on an explicit click. */
export const TailscaleFixKind = z.enum([
  "install-cli",
  "open-url",
  "sign-in",
  "start-daemon",
]);
export type TailscaleFixKind = z.infer<typeof TailscaleFixKind>;

export const TailscaleStep = z.object({
  id: TailscaleStepId,
  title: z.string(),
  state: TailscaleStepState,
  /** One-line, user-facing summary of the current state. */
  message: z.string(),
  /** Raw CLI output, shown behind "Why" when something failed. */
  detail: z.string().nullable(),
  /** The in-app fix, when there is one. */
  fix: TailscaleFixKind.nullable(),
  fixLabel: z.string().nullable(),
  /** Page to open for fixes the user must complete in a browser. */
  url: z.string().nullable(),
});
export type TailscaleStep = z.infer<typeof TailscaleStep>;

export const TailscaleDiagnosis = z.object({
  steps: z.array(TailscaleStep),
  /** True when every check passed — Funnel will start. */
  ready: z.boolean(),
  /** Resolved binary, or null when nothing is installed. */
  bin: z.string().nullable(),
  /** `*.ts.net` name of this node once known. */
  dnsName: z.string().nullable(),
});
export type TailscaleDiagnosis = z.infer<typeof TailscaleDiagnosis>;

export const TailscaleFixResult = z.object({
  /** Fresh diagnosis after the fix, so the UI can just re-render. */
  diagnosis: TailscaleDiagnosis,
  /** A URL the host opened in the browser, when the fix produced one. */
  openUrl: z.string().nullable(),
  /** Set when the fix itself failed, separate from the step states. */
  error: z.string().nullable(),
});
export type TailscaleFixResult = z.infer<typeof TailscaleFixResult>;

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
  "tailscale-not-ready",
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
