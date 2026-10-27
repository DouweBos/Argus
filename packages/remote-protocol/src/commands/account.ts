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
  /** Become the approver of another computer's link; shows the code. */
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
  account_set_config: {
    tier: "host",
    params: z.object({ patch: AccountConfigPatch }),
    result: AccountStatus,
  },
} as const satisfies Record<string, CommandSpec>;
