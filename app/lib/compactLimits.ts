import type { ClaudeUsageLimits, UsageLimitWindow } from "./types";
import {
  limitTone,
  percentLeft,
  resetHint,
  type UsageLimitTone,
} from "./usageFormat";

export interface CompactLimit {
  id: string;
  label: string;
  progress: number;
  title?: string;
  tone: UsageLimitTone;
  value: string;
}

function toCompact(
  id: string,
  label: string,
  w: UsageLimitWindow,
  now: number,
): CompactLimit {
  return {
    id,
    label,
    value: `${percentLeft(w.used_percent)}% left`,
    progress: w.used_percent / 100,
    tone: limitTone(w),
    title: resetHint(w.resets_at, now) ?? undefined,
  };
}

/** Every window of a lone account; with several, each account's tightest one. */
export function compactLimits(
  data: ClaudeUsageLimits | null,
  now: number,
): CompactLimit[] {
  const accounts = (data?.accounts ?? []).filter((a) => a.windows.length > 0);
  const [only] = accounts;
  if (accounts.length === 1 && only) {
    return only.windows.map((w) =>
      toCompact(`${only.account_id}:${w.id}`, w.label, w, now),
    );
  }

  return accounts.map((a) => {
    const tightest = a.windows.reduce((max, w) =>
      w.used_percent > max.used_percent ? w : max,
    );

    return toCompact(
      a.account_id,
      `${a.label} · ${tightest.label}`,
      tightest,
      now,
    );
  });
}

const TONE_RANK: Record<UsageLimitTone, number> = {
  accent: 0,
  warning: 1,
  danger: 2,
};

/** The most severe tone among the limits shown. */
export function worstTone(limits: CompactLimit[]): UsageLimitTone {
  return limits.reduce<UsageLimitTone>(
    (worst, l) => (TONE_RANK[l.tone] > TONE_RANK[worst] ? l.tone : worst),
    "accent",
  );
}
