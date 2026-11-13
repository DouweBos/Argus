/**
 * A provider's accounts pooled into one card per plan window: how much of the
 * pool is left, each account's share as a segment, and what the next reset
 * gives back. Mirrored by the native apps' `UsagePools`.
 */

import type {
  ClaudeAccountLimits,
  UsageLimitWindow,
} from "@argus/remote-protocol";
import {
  formatCountdown,
  limitTone,
  percentLeft,
  resetHint,
  type UsageLimitTone,
} from "./usageFormat";

/** One account of a provider, whatever the provider calls it. */
export interface PoolAccount {
  id: string;
  label: string;
  plan: string | null;
  windows: UsageLimitWindow[];
}

/** One account's column in a pooled bar. */
export interface UsagePoolSegment {
  accountId: string;
  label: string;
  plan: string | null;
  /** False leaves a gap: the account has no such window. */
  present: boolean;
  /** Share of this account's window used, 0–1. */
  used: number;
  /** Its used part comes back at the pool's next reset: drawn hatched. */
  restoring: boolean;
  /** "Resets in 2h 13m"; null when unknown or absent. */
  resetHint: string | null;
  /** "Work · max · 38% left · Resets in 2h 13m", for hover and the detail line. */
  detail: string;
}

export interface UsagePoolView {
  /** The window id the accounts share. */
  id: string;
  label: string;
  /** "62% left" across the pool. */
  value: string;
  /** Pool used, 0–1. */
  progress: number;
  tone: UsageLimitTone;
  /** "Work resets in 2h 13m, giving back 31% of the pool"; null without a known reset. */
  next: string | null;
  segments: UsagePoolSegment[];
}

const isWeeklySpent = (account: PoolAccount): boolean =>
  account.windows.some((w) => w.kind === "weekly" && w.used_percent >= 100);

/** The soonest a weekly cap that's spent comes back, which gates the session too. */
function weeklyReset(account: PoolAccount): number | null {
  const resets = account.windows
    .filter((w) => w.kind === "weekly" && w.used_percent >= 100)
    .map((w) => w.resets_at)
    .filter((r): r is number => r !== null);

  return resets.length > 0 ? Math.max(...resets) : null;
}

function sessionReset(account: PoolAccount): number {
  const session = account.windows.find((w) => w.kind === "session");

  return session?.resets_at ?? Number.POSITIVE_INFINITY;
}

/** Soonest session reset first, so the column order matches across cards. */
export function poolOrder(accounts: PoolAccount[]): PoolAccount[] {
  return accounts
    .map((a, i) => ({ a, i }))
    .sort((x, y) => sessionReset(x.a) - sessionReset(y.a) || x.i - y.i)
    .map(({ a }) => a);
}

interface Cell {
  account: PoolAccount;
  window: UsageLimitWindow | null;
  usedPercent: number;
  resetsAt: number | null;
}

function cellFor(account: PoolAccount, id: string): Cell {
  const window = account.windows.find((w) => w.id === id) ?? null;
  if (!window) {
    return { account, window, usedPercent: 0, resetsAt: null };
  }
  // A spent weekly cap leaves nothing in the session either, until it resets.
  if (window.kind === "session" && isWeeklySpent(account)) {
    return {
      account,
      window,
      usedPercent: 100,
      resetsAt: weeklyReset(account) ?? window.resets_at,
    };
  }

  return {
    account,
    window,
    usedPercent: Math.min(100, Math.max(0, window.used_percent)),
    resetsAt: window.resets_at,
  };
}

function poolView(
  id: string,
  ordered: PoolAccount[],
  now: number,
): UsagePoolView {
  const cells = ordered.map((a) => cellFor(a, id));
  const present = cells.filter((c) => c.window !== null);
  const count = present.length;
  const left =
    count > 0
      ? present.reduce((sum, c) => sum + (100 - c.usedPercent), 0) / count
      : 0;
  const first = present[0]?.window;
  const next = present
    .filter((c) => c.resetsAt !== null && c.resetsAt > now && c.usedPercent > 0)
    .sort((a, b) => (a.resetsAt ?? 0) - (b.resetsAt ?? 0))[0];
  const giveBack = next && count > 0 ? next.usedPercent / count : 0;
  const countdown =
    next?.resetsAt != null ? formatCountdown(next.resetsAt - now) : null;

  return {
    id,
    label: first?.label ?? id,
    value: `${String(percentLeft(100 - left))}% left`,
    progress: count > 0 ? 1 - left / 100 : 0,
    tone: limitTone({
      id,
      kind: first?.kind ?? "session",
      label: first?.label ?? id,
      used_percent: 100 - left,
      resets_at: null,
      window_minutes: null,
      pace: null,
    }),
    next:
      next && countdown
        ? `${next.account.label} resets in ${countdown}, giving back ${String(Math.round(giveBack))}% of the pool`
        : null,
    segments: cells.map((c) => {
      const hint = c.window ? resetHint(c.resetsAt, now) : null;
      const parts = [
        c.account.label,
        c.account.plan,
        c.window
          ? `${String(percentLeft(c.usedPercent))}% left`
          : "No such limit",
        hint,
      ].filter((p): p is string => Boolean(p));

      return {
        accountId: c.account.id,
        label: c.account.label,
        plan: c.account.plan,
        present: c.window !== null,
        used: c.usedPercent / 100,
        restoring: next !== undefined && c === next,
        resetHint: hint,
        detail: parts.join(" · "),
      };
    }),
  };
}

/**
 * One card per window id across the accounts, in the order windows first
 * appear. Null below two accounts with windows: one account keeps its meters.
 */
export function usagePoolViews(
  accounts: PoolAccount[],
  now: number,
): UsagePoolView[] | null {
  const pooled = poolOrder(accounts.filter((a) => a.windows.length > 0));
  if (pooled.length < 2) {
    return null;
  }
  const ids: string[] = [];
  for (const account of pooled) {
    for (const w of account.windows) {
      if (!ids.includes(w.id)) {
        ids.push(w.id);
      }
    }
  }

  return ids.map((id) => poolView(id, pooled, now));
}

/** Claude accounts as pool members: unsupported sign-ins have no plan to pool. */
export function claudePoolAccounts(
  accounts: ClaudeAccountLimits[],
): PoolAccount[] {
  return accounts
    .filter((a) => a.status !== "unsupported")
    .map((a) => ({
      id: a.account_id,
      label: a.label,
      plan: a.subscription_type,
      windows: a.windows,
    }));
}
