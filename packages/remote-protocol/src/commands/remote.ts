import { z } from "zod";
import { RemoteDeviceClaimState } from "../models";
import {
  HuddleRoomModel,
  McpAccess,
  PairedDevice,
  RemoteConfigPatch,
  RemotePairingStart,
  RemotePushConfig,
  RemotePushConfigPatch,
  RemotePushTestResult,
  RemoteStatus,
  ShareReadiness,
} from "../models/remote";
import { type CommandSpec, NoParams, Void } from "./spec";

const DeviceId = z.object({ deviceId: z.string() });
const RoomId = z.object({ roomId: z.string() });
const RoomGuest = RoomId.extend({ devStaticPub: z.string() });
/** `admin` is another Mac of yours driving this one — never a browser. */
const Grants = {
  control: z.boolean().default(false),
  admin: z.boolean().default(false),
};

/**
 * Host tier throughout pairing, grants and huddles: they are the root of trust
 * the wire itself is authorised by, so none of them may cross it.
 */
export const REMOTE_COMMANDS = {
  remote_get_status: { tier: "admin", params: NoParams, result: RemoteStatus },
  /** This computer's public key (base64url), naming it in a Handoff activity. */
  remote_get_host_key: { tier: "admin", params: NoParams, result: z.string() },
  remote_set_config: {
    tier: "host",
    params: z.object({ config: RemoteConfigPatch }),
    result: RemoteStatus,
  },
  remote_get_push_config: {
    tier: "admin",
    params: NoParams,
    result: RemotePushConfig,
  },
  remote_set_push_config: {
    tier: "admin",
    params: z.object({ patch: RemotePushConfigPatch }),
    result: RemotePushConfig,
  },
  remote_test_push: {
    tier: "admin",
    params: DeviceId,
    result: RemotePushTestResult,
  },
  remote_list_devices: {
    tier: "admin",
    params: NoParams,
    result: z.array(PairedDevice),
  },
  remote_revoke_device: {
    tier: "host",
    params: DeviceId,
    result: RemoteStatus,
  },
  /** SAS, completion and failure arrive as `remote:pairing-*` events. */
  remote_start_pairing: {
    tier: "host",
    params: NoParams,
    result: RemotePairingStart,
  },
  remote_confirm_pairing: {
    tier: "host",
    params: z.object(Grants),
    result: Void,
  },
  remote_cancel_pairing: { tier: "host", params: NoParams, result: Void },
  /** Drops the live connection so it reconnects with the fresh grants. */
  remote_set_device_control: {
    tier: "host",
    params: DeviceId.extend(Grants),
    result: z.array(PairedDevice),
  },
  /** Answer an outside MCP client's sign-in, choosing what it may do. */
  remote_mcp_decide: {
    tier: "host",
    params: z.object({
      requestId: z.string(),
      approve: z.boolean(),
      access: McpAccess,
    }),
    result: RemoteStatus,
  },
  /** Its live connections drop at once. */
  remote_mcp_revoke: {
    tier: "host",
    params: z.object({ grantId: z.string() }),
    result: RemoteStatus,
  },
  /** Its live connections drop and reconnect with the new tools. */
  remote_mcp_set_access: {
    tier: "host",
    params: z.object({ grantId: z.string(), access: McpAccess }),
    result: RemoteStatus,
  },
  /** An empty or null `deviceKey` makes the room chat-only. */
  huddle_start: {
    tier: "host",
    params: z.object({
      agentId: z.string(),
      deviceKey: z.string().nullish(),
      hostLabel: z.string().optional(),
    }),
    result: HuddleRoomModel,
  },
  huddle_share_readiness: {
    tier: "host",
    params: NoParams,
    result: ShareReadiness,
  },
  huddle_stop: { tier: "host", params: RoomId, result: z.boolean() },
  huddle_set_device: {
    tier: "host",
    params: RoomId.extend({ deviceKey: z.string().nullish() }),
    result: z.boolean(),
  },
  /** Rooms are in memory, so this is empty after a restart. */
  huddle_list: {
    tier: "host",
    params: NoParams,
    result: z.array(HuddleRoomModel),
  },
  device_claim_status: {
    tier: "admin",
    params: DeviceId,
    result: RemoteDeviceClaimState,
  },
  /** The huddle's side chat only — it never reaches the agent. */
  huddle_say: {
    tier: "host",
    params: RoomId.extend({ text: z.string() }),
    result: z.boolean(),
  },
  huddle_set_typing: {
    tier: "host",
    params: RoomId.extend({ typing: z.boolean() }),
    result: z.boolean(),
  },
  huddle_approve_guest: {
    tier: "host",
    params: RoomGuest,
    result: z.boolean(),
  },
  huddle_deny_guest: { tier: "host", params: RoomGuest, result: z.boolean() },
  huddle_remove_guest: { tier: "host", params: RoomGuest, result: z.boolean() },
} as const satisfies Record<string, CommandSpec>;
