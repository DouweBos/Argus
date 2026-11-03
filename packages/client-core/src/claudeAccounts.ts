/**
 * The computer's Claude accounts as lists and pickers show them, and where a
 * sign-in has got to. Mirrors `HostStore+ClaudeAccounts`; takes both the
 * desktop's `ClaudeAccount` and the gateway's `RemoteClaudeAccount`.
 */

import type { RemoteClaudeLoginState } from "@argus/remote-protocol";

export interface ClaudeAccountLike {
  id: string;
  label?: string | null;
  email?: string | null;
  org_name?: string | null;
  subscription_type?: string | null;
  needs_reauth?: boolean;
  rate_limited?: boolean;
  account_type: "claudeai" | "console";
}

/** One row of an account list. */
export interface ClaudeAccountRowView {
  id: string;
  label: string;
  detail?: string;
  plan?: string;
  active: boolean;
  needsReauth: boolean;
  rateLimited: boolean;
  console: boolean;
}

const SUBSCRIPTION_LABELS: Record<string, string> = {
  team: "Team",
  pro: "Pro",
  max: "Max",
  enterprise: "Enterprise",
  free: "Free",
};

export function claudeAccountName(account: ClaudeAccountLike): string {
  return account.label || account.email || "Signing in…";
}

export function claudePlanLabel(
  account: ClaudeAccountLike,
): string | undefined {
  const plan = account.subscription_type;
  if (!plan) {
    return undefined;
  }

  return SUBSCRIPTION_LABELS[plan] ?? plan;
}

/** Org, plus the email when it isn't already the name. */
export function claudeAccountDetail(
  account: ClaudeAccountLike,
): string | undefined {
  const parts = [
    account.label && account.email ? account.email : null,
    account.org_name,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function claudeAccountRows(
  accounts: ClaudeAccountLike[],
  activeId: string | null,
): ClaudeAccountRowView[] {
  return accounts.map((account) => ({
    id: account.id,
    label: claudeAccountName(account),
    detail: claudeAccountDetail(account),
    plan: claudePlanLabel(account),
    active: account.id === activeId,
    needsReauth: account.needs_reauth === true,
    rateLimited: account.rate_limited === true,
    console: account.account_type === "console",
  }));
}

/** The picker value for "whichever account the computer has active". */
export const FOLLOW_DEFAULT_ACCOUNT = "";

/** With one account there is nothing to switch between. */
export function offersAccountPicker(accounts: ClaudeAccountLike[]): boolean {
  return accounts.length > 1;
}

export interface AccountPickerOption {
  value: string;
  name: string;
  description?: string;
}

/** "Default account" first, naming the one it follows, then every account. */
export function accountPickerOptions(
  accounts: ClaudeAccountLike[],
  activeId: string | null,
): AccountPickerOption[] {
  const active = accounts.find((a) => a.id === activeId);

  return [
    {
      value: FOLLOW_DEFAULT_ACCOUNT,
      name: "Default account",
      description: active
        ? `Follows the computer: ${claudeAccountName(active)}`
        : "Follows the computer's active account",
    },
    ...accounts.map((a) => ({
      value: a.id,
      name: claudeAccountName(a),
      description: claudeAccountDetail(a) ?? claudePlanLabel(a),
    })),
  ];
}

/**
 * The picker for an automation's account pin. A pin to an account since
 * signed out stays listed, so the editor can say why its runs fail.
 */
export function automationAccountOptions(
  accounts: ClaudeAccountLike[],
  activeId: string | null,
  pinnedId: string | null | undefined,
): AccountPickerOption[] {
  const options = accountPickerOptions(accounts, activeId);
  if (!pinnedId || accounts.some((a) => a.id === pinnedId)) {
    return options;
  }

  return [
    ...options,
    {
      value: pinnedId,
      name: "Signed-out account",
      description: "Runs fail until it is signed back in",
    },
  ];
}

/** What the account chip reads: the pinned account, else "Default account". */
export function accountPickerLabel(
  accounts: ClaudeAccountLike[],
  pinnedId: string | null | undefined,
): string {
  const pinned = pinnedId ? accounts.find((a) => a.id === pinnedId) : null;

  return pinned ? claudeAccountName(pinned) : "Default account";
}

/** "Running as Work", when there is more than one account to tell apart. */
export function runningAsLabel(
  accounts: ClaudeAccountLike[],
  accountId: string | null | undefined,
): string | null {
  if (!accountId || !offersAccountPicker(accounts)) {
    return null;
  }
  const account = accounts.find((a) => a.id === accountId);

  return account ? `Running as ${claudeAccountName(account)}` : null;
}

export type ClaudeSignInPhase =
  | "awaiting-browser"
  | "awaiting-code"
  | "idle"
  | "starting"
  | "submitting";

/**
 * Where a sign-in stands: asked for and not answered yet, waiting on the
 * computer's browser (a remote client can paste the code either way), or a
 * code on its way. `login` is what the computer last reported.
 */
export function claudeSignInPhase(
  login: RemoteClaudeLoginState | null,
  local: { starting: boolean; submitting: boolean },
): ClaudeSignInPhase {
  if (local.starting) {
    return "starting";
  }
  if (!login?.pending) {
    return "idle";
  }
  if (local.submitting) {
    return "submitting";
  }

  return login.needs_code ? "awaiting-code" : "awaiting-browser";
}

/** How the last attempt ended, once it has. */
export function claudeSignInOutcome(
  login: RemoteClaudeLoginState | null,
): { ok: false; error: string } | { ok: true } | null {
  if (!login || login.pending) {
    return null;
  }
  if (login.ok) {
    return { ok: true };
  }
  if (login.error) {
    return { ok: false, error: login.error };
  }

  return null;
}
