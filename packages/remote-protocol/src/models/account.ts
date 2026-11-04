import { z } from "zod";
import { HostMember } from "../account/schema";
import { RemoteEndpoint } from "../models";

// --- Account (directory + signed log) ---------------------------------------

/** Where a host's code link is (§5.2a). Shared by every console surface. */
export const AccountLinkState = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("idle") }),
  z.object({
    kind: z.literal("awaiting_claim"),
    user_code: z.string(),
    verification_uri: z.string(),
    verification_uri_complete: z.string(),
    expires_at: z.number(),
  }),
  /** The account is empty: confirm this computer becomes its first member. */
  z.object({ kind: z.literal("awaiting_first") }),
  z.object({
    kind: z.literal("awaiting_sas"),
    sas: z.string(),
    approver_name: z.string(),
  }),
  /** Codes confirmed here; waiting for the approver to write the entry. */
  z.object({ kind: z.literal("awaiting_approval") }),
  z.object({ kind: z.literal("linked") }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type AccountLinkState = z.infer<typeof AccountLinkState>;

/** Whether a join request is for a computer or a device. */
export const AccountMemberRole = z.enum(["device", "host"]);
export type AccountMemberRole = z.infer<typeof AccountMemberRole>;

/** This host's console approving another computer or device (§4.4). */
export const AccountApprovalState = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("idle") }),
  z.object({
    kind: z.literal("awaiting_sas"),
    request_id: z.string(),
    sas: z.string(),
    subject_name: z.string(),
    subject_role: AccountMemberRole,
  }),
  z.object({
    kind: z.literal("approved"),
    request_id: z.string(),
    subject_role: AccountMemberRole,
  }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type AccountApprovalState = z.infer<typeof AccountApprovalState>;

export const AccountGrantSetting = z.enum(["monitor", "control", "admin"]);
export type AccountGrantSetting = z.infer<typeof AccountGrantSetting>;

/** Machine-local account settings, kept in the encrypted remote store (§8). */
export const AccountConfig = z.object({
  /** Off: no presence, no polling, account devices refused — still linked. */
  enabled: z.boolean(),
  /** Override the account service. Empty means the built-in one. */
  service_url: z.string(),
  grants: z.object({
    ios: AccountGrantSetting,
    desktop: AccountGrantSetting,
  }),
  publish: z.object({
    lan: z.boolean(),
    tailscale: z.boolean(),
    cloudflare: z.boolean(),
  }),
  hosts_can_approve: z.boolean(),
  /** Run the account's managed tunnel while remote access is on. */
  tunnel: z.boolean(),
});
export type AccountConfig = z.infer<typeof AccountConfig>;

export const AccountConfigPatch = z.object({
  enabled: z.boolean().optional(),
  service_url: z.string().optional(),
  grants: z
    .object({
      ios: AccountGrantSetting.optional(),
      desktop: AccountGrantSetting.optional(),
    })
    .optional(),
  publish: z
    .object({
      lan: z.boolean().optional(),
      tailscale: z.boolean().optional(),
      cloudflare: z.boolean().optional(),
    })
    .optional(),
  hosts_can_approve: z.boolean().optional(),
  tunnel: z.boolean().optional(),
});
export type AccountConfigPatch = z.infer<typeof AccountConfigPatch>;

/** The account moved to a newer epoch without this computer (§5.8): link it again. */
export const AccountResetNotice = z.object({
  epoch: z.number().int(),
  /** When the reset's genesis was signed. */
  at: z.number(),
  /** The device that reset the account, as it named itself. */
  by_name: z.string().nullable(),
});
export type AccountResetNotice = z.infer<typeof AccountResetNotice>;

export const AccountStatus = z.object({
  linked: z.boolean(),
  account_id: z.string().nullable(),
  epoch: z.number().int().nullable(),
  /** This host's member id once linked. */
  host_id: z.string().nullable(),
  /** The Electron window's device on the account; it signs removals and renames. */
  device_id: z.string().nullable(),
  /** `XXXX-XXXX-XXXX` from the genesis hash, for a by-eye check. */
  safety_code: z.string().nullable(),
  head_seq: z.number().int().nullable(),
  /** Set when the service served a log this host refused (fork, bad sig…). */
  log_error: z.string().nullable(),
  /** Last time the presence reached the service. */
  presence_at: z.number().nullable(),
  config: AccountConfig,
  link: AccountLinkState,
  /** This computer's name: what it joins and links as, and keeps on the account. */
  name: z.string().optional(),
  /** The name the system gives this computer, used while `name` isn't set. */
  system_name: z.string().optional(),
  /** Set after the account was reset elsewhere, until this computer links again or it's dismissed. */
  reset: AccountResetNotice.nullable().optional(),
});
export type AccountStatus = z.infer<typeof AccountStatus>;

/** A computer on the account, from the verified log + verified presence. */
export const AccountHost = z.object({
  host_id: z.string(),
  name: z.string(),
  platform: z.string(),
  /** X25519 Noise static key, base64 — what a client pins. */
  noise_pub: z.string(),
  endpoints: z.array(RemoteEndpoint),
  last_seen: z.number().nullable(),
  online: z.boolean(),
  is_self: z.boolean(),
});
export type AccountHost = z.infer<typeof AccountHost>;

export const AccountMemberInfo = z.object({
  id: z.string(),
  role: AccountMemberRole,
  /** Device kind (`ios`/`mac`/`electron`) or host platform. */
  kind: z.string(),
  name: z.string(),
  created_at: z.number(),
  is_self: z.boolean(),
});
export type AccountMemberInfo = z.infer<typeof AccountMemberInfo>;

/** A computer's link or a device's join waiting for approval. */
export const AccountJoinRequest = z.object({
  request_id: z.string(),
  /** `host`/`computer` for a code link, `device` for a signed-in app. */
  kind: z.string(),
  subject_name: z.string(),
  subject_role: AccountMemberRole,
  /** Device kind (`ios`/`mac`/`electron`) or host platform. */
  subject_kind: z.string(),
  status: z.string(),
  created_at: z.number(),
  expires_at: z.number(),
});
export type AccountJoinRequest = z.infer<typeof AccountJoinRequest>;

/** Electron's own account device key, for dialing other account hosts. */
export const AccountDeviceKey = z.object({
  device_id: z.string(),
  noise_priv: z.string(),
  noise_pub: z.string(),
});
export type AccountDeviceKey = z.infer<typeof AccountDeviceKey>;

export const AccountLocalLinkOffer = z.object({
  host: HostMember,
  proof: z.string(),
});
export type AccountLocalLinkOffer = z.infer<typeof AccountLocalLinkOffer>;

export const AccountLinkSurface = z.enum(["electron", "mac", "cli", "menubar"]);
export type AccountLinkSurface = z.infer<typeof AccountLinkSurface>;
