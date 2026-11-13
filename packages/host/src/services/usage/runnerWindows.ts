/**
 * Plan windows from what Codex, Cursor, Grok and OpenCode Go report, in the same shape as
 * Claude's so every runner's meters read alike.
 */

import type { UsageLimitWindow } from "@argus/remote-protocol";
import { clampPercent, paceFor } from "./limitWindows";

const DAY_MINUTES = 24 * 60;

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

function kindFor(minutes: number | null): UsageLimitWindow["kind"] {
  if (minutes === null || minutes > 8 * DAY_MINUTES) {
    return "monthly";
  }

  return minutes > DAY_MINUTES ? "weekly" : "session";
}

/** "Session" for Codex's 5 hours, "Weekly" for 7 days, else the length. */
function labelFor(minutes: number | null): string {
  if (minutes === 300) {
    return "Session";
  }
  if (minutes === 7 * DAY_MINUTES) {
    return "Weekly";
  }
  if (minutes === null || minutes > 8 * DAY_MINUTES) {
    return "Monthly";
  }

  return minutes >= DAY_MINUTES
    ? `${Math.round(minutes / DAY_MINUTES)}-day`
    : `${Math.round(minutes / 60)}-hour`;
}

export function makeWindow(
  w: {
    id: string;
    label?: string;
    kind?: UsageLimitWindow["kind"];
    used: number;
    resetsAt: number | null;
    minutes: number | null;
  },
  now: number,
): UsageLimitWindow {
  const used = clampPercent(w.used);

  return {
    id: w.id,
    kind: w.kind ?? kindFor(w.minutes),
    label: w.label ?? labelFor(w.minutes),
    used_percent: used,
    resets_at: w.resetsAt,
    window_minutes: w.minutes,
    pace: paceFor(used, w.resetsAt, w.minutes, now),
  };
}

export interface CodexLimitsParsed {
  windows: UsageLimitWindow[];
  plan: string | null;
}

/** `account/rateLimits/read` or `account/rateLimits/updated`: primary and secondary windows. */
export function codexWindows(raw: unknown, now: number): CodexLimitsParsed {
  if (!isRecord(raw)) {
    return { windows: [], plan: null };
  }
  const byId = isRecord(raw.rateLimitsByLimitId)
    ? raw.rateLimitsByLimitId.codex
    : undefined;
  const fallback = isRecord(raw.rateLimits) ? raw.rateLimits : raw;
  const snapshot = isRecord(byId) ? byId : fallback;
  const windows: UsageLimitWindow[] = [];
  for (const id of ["primary", "secondary"] as const) {
    const w = snapshot[id];
    if (!isRecord(w) || !finite(w.usedPercent)) {
      continue;
    }
    const minutes = finite(w.windowDurationMins) ? w.windowDurationMins : null;
    windows.push(
      makeWindow(
        {
          id,
          used: w.usedPercent,
          // Unix seconds on the wire.
          resetsAt: finite(w.resetsAt) ? w.resetsAt * 1000 : null,
          minutes,
        },
        now,
      ),
    );
  }
  const plan =
    typeof snapshot.planType === "string" && snapshot.planType !== "unknown"
      ? snapshot.planType
      : null;

  return { windows, plan };
}

const epochMs = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;

  return finite(n) && n > 0 ? n : null;
};

/** Cursor's `GetCurrentPeriodUsage`: one monthly window per plan pool. */
export function cursorWindows(raw: unknown, now: number): UsageLimitWindow[] {
  if (!isRecord(raw) || !isRecord(raw.planUsage)) {
    return [];
  }
  const end = epochMs(raw.billingCycleEnd);
  const start = epochMs(raw.billingCycleStart);
  const minutes =
    end !== null && start !== null && end > start
      ? Math.round((end - start) / 60_000)
      : null;
  const pools = [
    ["totalPercentUsed", "total", "Monthly"],
    ["autoPercentUsed", "auto", "Monthly · Auto"],
    ["apiPercentUsed", "api", "Monthly · API"],
  ] as const;

  return pools.flatMap(([field, id, label]) => {
    const used = raw.planUsage && (raw.planUsage as Json)[field];

    return finite(used)
      ? [
          makeWindow(
            { id, label, kind: "monthly", used, resetsAt: end, minutes },
            now,
          ),
        ]
      : [];
  });
}

/** Grok's billing endpoint: the current subscription period's credit use. */
export function grokWindows(raw: unknown, now: number): UsageLimitWindow[] {
  const config = isRecord(raw) && isRecord(raw.config) ? raw.config : null;
  const period =
    config && isRecord(config.currentPeriod) ? config.currentPeriod : null;
  const type =
    typeof period?.type === "string"
      ? period.type.replace(/^USAGE_PERIOD_TYPE_/, "")
      : "";
  const start =
    typeof period?.start === "string" ? Date.parse(period.start) : NaN;
  const end = typeof period?.end === "string" ? Date.parse(period.end) : NaN;
  const minutes =
    Number.isFinite(start) && Number.isFinite(end) && end > start
      ? Math.round((end - start) / 60_000)
      : null;
  // A period with nothing spent yet comes without a percentage.
  const unspent = minutes === null ? null : 0;
  const used = finite(config?.creditUsagePercent)
    ? config.creditUsagePercent
    : unspent;
  if (used === null) {
    return [];
  }
  const weekly = type === "WEEKLY";

  return [
    makeWindow(
      {
        id: "subscription",
        label: weekly ? "Weekly" : "Monthly",
        kind: weekly ? "weekly" : "monthly",
        used,
        resetsAt: Number.isFinite(end) ? end : null,
        minutes,
      },
      now,
    ),
  ];
}

const OPENCODE_GO_WINDOWS = [
  ["rolling", "session", "Session", 5 * 60],
  ["weekly", "weekly", "Weekly", 7 * DAY_MINUTES],
  ["monthly", "monthly", "Monthly", null],
] as const;

/** OpenCode Go's `/zen/go/v1/usage`: rolling 5-hour, weekly and monthly allowances. */
export function opencodeGoWindows(
  raw: unknown,
  now: number,
): UsageLimitWindow[] {
  const usage = isRecord(raw) && isRecord(raw.usage) ? raw.usage : null;
  if (!usage) {
    return [];
  }

  return OPENCODE_GO_WINDOWS.flatMap(([id, kind, label, minutes]) => {
    const w = usage[id];
    if (!isRecord(w) || !finite(w.percent)) {
      return [];
    }
    const reset =
      typeof w.resetsAt === "string" ? Date.parse(w.resetsAt) : w.resetsAt;
    // An ISO date on the wire; a bare number below 1e12 is Unix seconds.
    let resetsAt = finite(reset) ? reset : null;
    if (resetsAt !== null && resetsAt < 1e12) {
      resetsAt *= 1000;
    }

    return [
      makeWindow(
        {
          id,
          label,
          kind,
          used: w.percent,
          resetsAt,
          minutes,
        },
        now,
      ),
    ];
  });
}
