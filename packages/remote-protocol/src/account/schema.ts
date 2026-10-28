/**
 * Wire shapes of the account log, presence records and members. The log is
 * the only thing any client trusts; the service's tables are derived from it.
 * Byte-level rules (encodings, signed strings) live in `sign.ts`.
 */

import { z } from "zod";

function hasControlChar(name: string): boolean {
  for (let i = 0; i < name.length; i += 1) {
    const code = name.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }

  return false;
}

/** A display name: short, single-line, no control characters. */
export const MemberName = z
  .string()
  .min(1)
  .max(64)
  .refine((name) => !hasControlChar(name), "control characters");

/**
 * A name typed into a "Name" setting: trimmed, then 1–64 UTF-16 units with no
 * control characters. Null when it doesn't qualify. Mirrors Swift's
 * `AccountDeviceKeys.validatedName`.
 */
export function normalizeMemberName(raw: string): string | null {
  const name = raw.trim();

  return MemberName.safeParse(name).success ? name : null;
}

const MemberBase = {
  id: z.string().min(1),
  sign_pub: z.string().min(1),
  noise_pub: z.string().min(1),
  name: MemberName,
  created_at: z.number(),
};

export const DeviceKind = z.enum(["ios", "mac", "electron"]);
export type DeviceKind = z.infer<typeof DeviceKind>;

export const HostPlatformKind = z.enum(["darwin", "linux"]);
export type HostPlatformKind = z.infer<typeof HostPlatformKind>;

export const DeviceMember = z.object({
  ...MemberBase,
  role: z.literal("device"),
  kind: DeviceKind,
});
export type DeviceMember = z.infer<typeof DeviceMember>;

export const HostMember = z.object({
  ...MemberBase,
  role: z.literal("host"),
  platform: HostPlatformKind,
});
export type HostMember = z.infer<typeof HostMember>;

export const AccountMember = z.discriminatedUnion("role", [
  DeviceMember,
  HostMember,
]);
export type AccountMember = z.infer<typeof AccountMember>;

/** One log entry exactly as stored and transmitted. */
export const LogEntry = z.object({
  body: z.string(),
  sigs: z.record(z.string(), z.string()),
});
export type LogEntry = z.infer<typeof LogEntry>;

const BodyBase = {
  v: z.literal(1),
  account_id: z.string().min(1),
  epoch: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  prev: z.string(),
  ts: z.number(),
  signer: z.string().min(1),
};

export const RevokeReason = z.enum(["removed", "lost", "unlinked"]);
export type RevokeReason = z.infer<typeof RevokeReason>;

export const LogBody = z.discriminatedUnion("type", [
  z.object({ ...BodyBase, type: z.literal("genesis"), member: AccountMember }),
  z.object({
    ...BodyBase,
    type: z.literal("add_device"),
    member: DeviceMember,
    request_id: z.string(),
    sas_commit: z.string(),
    proof: z.string().min(1),
  }),
  z.object({
    ...BodyBase,
    type: z.literal("add_host"),
    member: HostMember,
    request_id: z.string(),
    sas_commit: z.string(),
    proof: z.string().min(1),
  }),
  z.object({
    ...BodyBase,
    type: z.literal("revoke"),
    member_id: z.string().min(1),
    reason: RevokeReason,
  }),
  z.object({
    ...BodyBase,
    type: z.literal("rotate"),
    member_id: z.string().min(1),
    sign_pub: z.string().min(1),
    noise_pub: z.string().min(1),
    proof: z.string().min(1),
  }),
  z.object({
    ...BodyBase,
    type: z.literal("rename"),
    member_id: z.string().min(1),
    name: MemberName,
  }),
]);
export type LogBody = z.infer<typeof LogBody>;
export type LogEntryType = LogBody["type"];

export const PresenceEndpoint = z.object({
  kind: z.enum(["lan", "tailscale", "cloudflare"]),
  url: z.string(),
  priority: z.number(),
});
export type PresenceEndpoint = z.infer<typeof PresenceEndpoint>;

export const PresenceBody = z.object({
  v: z.literal(1),
  account_id: z.string(),
  epoch: z.number().int().nonnegative(),
  host_id: z.string(),
  ts: z.number(),
  endpoints: z.array(PresenceEndpoint),
});
export type PresenceBody = z.infer<typeof PresenceBody>;

/** A directory row as the service returns it; untrusted until verified. */
export const DirectoryRecord = z.object({
  host_id: z.string(),
  presence_body: z.string(),
  presence_sig: z.string(),
  last_seen: z.number(),
});
export type DirectoryRecord = z.infer<typeof DirectoryRecord>;

/** What a verifier pins on first use. */
export const AccountRoot = z.object({
  account_id: z.string(),
  epoch: z.number().int().nonnegative(),
  genesis_hash: z.string(),
});
export type AccountRoot = z.infer<typeof AccountRoot>;
