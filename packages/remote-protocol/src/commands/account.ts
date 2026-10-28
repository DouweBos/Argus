import { z } from "zod";
import {
  AccountApprovalState,
  AccountConfigPatch,
  AccountDeviceKey,
  AccountHost,
  AccountJoinRequest,
  AccountLinkState,
  AccountLinkSurface,
  AccountLocalLinkOffer,
  AccountMemberInfo,
  AccountStatus,
} from "../models/account";
import { type CommandSpec, NoParams, Void } from "./spec";

/**
 * Linking, approving and unlinking are trust decisions — console-only, like
 * pairing. Reading the account is admin: another Mac of yours may look.
 */
export const ACCOUNT_COMMANDS = {
  account_get_status: {
    tier: "admin",
    params: NoParams,
    result: AccountStatus,
  },
  /** Computers on the account, verified against the log. */
  account_list_hosts: {
    tier: "admin",
    params: NoParams,
    result: z.array(AccountHost),
  },
  account_list_members: {
    tier: "admin",
    params: NoParams,
    result: z.array(AccountMemberInfo),
  },
  /** The Electron window's own device key; never leaves the machine. */
  account_device_key: {
    tier: "host",
    params: NoParams,
    result: AccountDeviceKey.nullable(),
  },
  /** Start a code link; progress arrives as `account:link-state`. */
  account_login_start: {
    tier: "host",
    params: z.object({ surface: AccountLinkSurface }),
    result: AccountLinkState,
  },
  /** Answer the console prompt: codes match / become the first computer. */
  account_login_confirm: {
    tier: "host",
    params: z.object({ match: z.boolean() }),
    result: AccountLinkState,
  },
  account_login_cancel: {
    tier: "host",
    params: NoParams,
    result: AccountLinkState,
  },
  /** Unlink this computer: a signed self-revoke, then forget the account. */
  account_logout: { tier: "host", params: NoParams, result: AccountStatus },
  /** The Mac app linking its bundled host: the host's member + proof. */
  account_link_local_begin: {
    tier: "host",
    params: NoParams,
    result: AccountLocalLinkOffer,
  },
  /** After the app appended `add_host`: verify the log from this pin and adopt it. */
  account_link_local_finish: {
    tier: "host",
    params: z.object({
      accountId: z.string(),
      epoch: z.number().int(),
      genesisHash: z.string(),
    }),
    result: AccountStatus,
  },
  account_list_requests: {
    tier: "host",
    params: NoParams,
    result: z.array(AccountJoinRequest),
  },
  /** Become the approver of a computer's link or a device's join; shows the code. */
  account_approve_join: {
    tier: "host",
    params: z.object({ requestId: z.string() }),
    result: AccountApprovalState,
  },
  account_confirm_join: {
    tier: "host",
    params: z.object({ match: z.boolean() }),
    result: AccountApprovalState,
  },
  account_deny_join: {
    tier: "host",
    params: z.object({ requestId: z.string() }),
    result: Void,
  },
  /**
   * Take a member off the account. Signed by this window's device, which may
   * remove anyone; a host on its own may only remove itself (§4.2).
   */
  account_revoke_member: {
    tier: "host",
    params: z.object({ memberId: z.string() }),
    result: AccountStatus,
  },
  /** Rename a member; signed by this window's device, or the host for itself. */
  account_rename_member: {
    tier: "host",
    params: z.object({ memberId: z.string(), name: z.string() }),
    result: AccountStatus,
  },
  /**
   * This computer's name setting; `null` returns to the system name. While
   * linked, also renames this host (and its window's device) on the account.
   */
  account_set_name: {
    tier: "host",
    params: z.object({ name: z.string().nullable() }),
    result: AccountStatus,
  },
  account_set_config: {
    tier: "host",
    params: z.object({ patch: AccountConfigPatch }),
    result: AccountStatus,
  },
} as const satisfies Record<string, CommandSpec>;
