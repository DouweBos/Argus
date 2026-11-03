/**
 * An automation pinned to one Claude account — usually because its playbook
 * needs MCPs only that account has. A pinned run stays on it or doesn't run.
 */

import { accountFallbackOrder, getClaudeAccount } from "../claudeAuth/accounts";

export type AccountPinState = "missing" | "none" | "ok" | "reauth";

export function accountPinState(
  accountId: string | null | undefined,
): AccountPinState {
  if (!accountId) {
    return "none";
  }
  const account = getClaudeAccount(accountId);
  if (!account) {
    return "missing";
  }

  return account.needs_reauth ? "reauth" : "ok";
}

/** Why a pinned run can't start, or null when it can. */
export function accountPinError(
  accountId: string | null | undefined,
): string | null {
  const state = accountPinState(accountId);
  if (state === "missing") {
    return "The Claude account this automation is pinned to is no longer signed in. Sign it back in, or pick another account in the automation's settings.";
  }
  if (state === "reauth") {
    const account = accountId ? getClaudeAccount(accountId) : undefined;
    const name = account?.label || account?.email;

    return `The Claude account this automation is pinned to${name ? ` (${name})` : ""} needs you to sign in again before it can run.`;
  }

  return null;
}

/**
 * Accounts a run tries in order. A pinned run gets only its own — the others
 * lack whatever made it worth pinning. `null` leaves the session's account be.
 */
export function runAccountOrder(args: {
  pinnedId: string | null;
  sessionAccountId: string;
  retryOtherAccounts: boolean;
  defaultRunner: boolean;
}): (string | null)[] {
  if (!args.defaultRunner) {
    return [null];
  }
  if (args.pinnedId) {
    return [args.pinnedId];
  }

  return args.retryOtherAccounts
    ? accountFallbackOrder(args.sessionAccountId)
    : [null];
}
