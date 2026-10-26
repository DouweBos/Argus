/**
 * Turn the Claude CLI's `get_usage` answer and its streamed
 * `rate_limit_event`s into plan-limit windows.
 */

import type { UsageLimitWindow, UsagePace } from "@argus/remote-protocol";

const SESSION_MINUTES = 5 * 60;
const WEEK_MINUTES = 7 * 24 * 60;

/** Points a window may run ahead of or behind an even spend before it counts. */
const PACE_TOLERANCE = 5;

const FIXED: Record<
  string,
  Pick<UsageLimitWindow, "kind" | "label" | "window_minutes">
> = {
  five_hour: {
    kind: "session",
    label: "Session",
    window_minutes: SESSION_MINUTES,
  },
  seven_day: { kind: "weekly", label: "Weekly", window_minutes: WEEK_MINUTES },
};

/** The streamed type for the one model-scoped weekly cap the CLI reports. */
const SCOPED_EVENT_TYPE = "seven_day_overage_included";

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export const clampPercent = (v: number): number =>
  Math.min(100, Math.max(0, v));

function parseTime(v: unknown): number | null {
  if (typeof v !== "string" || !v) {
    return null;
  }
  const ms = Date.parse(v);

  return Number.isFinite(ms) ? ms : null;
}

/** Used share against elapsed share of the window. */
export function paceFor(
  usedPercent: number,
  resetsAt: number | null,
  windowMinutes: number | null,
  now: number,
): UsagePace | null {
  if (resetsAt === null || windowMinutes === null) {
    return null;
  }
  const length = windowMinutes * 60_000;
  const elapsed = Math.min(
    1,
    Math.max(0, (length - (resetsAt - now)) / length),
  );
  const gap = usedPercent - elapsed * 100;
  if (gap > PACE_TOLERANCE) {
    return "ahead";
  }

  return gap < -PACE_TOLERANCE ? "under" : "on";
}

function window(
  base: Omit<UsageLimitWindow, "pace" | "used_percent"> & { used: number },
  now: number,
): UsageLimitWindow {
  const used = clampPercent(base.used);

  return {
    id: base.id,
    kind: base.kind,
    label: base.label,
    used_percent: used,
    resets_at: base.resets_at,
    window_minutes: base.window_minutes,
    pace: paceFor(used, base.resets_at, base.window_minutes, now),
  };
}

export function scopedWindowId(displayName: string): string {
  return `seven_day_${displayName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

function scoped(
  name: string,
  used: number,
  resetsAt: number | null,
  now: number,
) {
  return window(
    {
      id: scopedWindowId(name),
      kind: "weekly",
      label: `Weekly · ${name}`,
      used,
      resets_at: resetsAt,
      window_minutes: WEEK_MINUTES,
    },
    now,
  );
}

/** `model_scoped` where the CLI sends it, else the `weekly_scoped` rows of `limits`. */
function scopedEntries(
  limits: Json,
): { name: string; used: number; resetsAt: number | null }[] {
  if (Array.isArray(limits.model_scoped)) {
    return limits.model_scoped
      .filter(isRecord)
      .filter(
        (e) => typeof e.display_name === "string" && finite(e.utilization),
      )
      .map((e) => ({
        name: e.display_name as string,
        used: e.utilization as number,
        resetsAt: parseTime(e.resets_at),
      }));
  }
  if (!Array.isArray(limits.limits)) {
    return [];
  }

  return limits.limits.filter(isRecord).flatMap((e) => {
    const model =
      isRecord(e.scope) && isRecord(e.scope.model) ? e.scope.model : null;
    if (
      e.kind !== "weekly_scoped" ||
      typeof model?.display_name !== "string" ||
      !finite(e.percent)
    ) {
      return [];
    }

    return [
      {
        name: model.display_name,
        used: e.percent,
        resetsAt: parseTime(e.resets_at),
      },
    ];
  });
}

function ratio(used: unknown, limit: unknown): number | null {
  if (!finite(used) || !finite(limit) || used < 0 || limit <= 0) {
    return null;
  }

  return clampPercent((used / limit) * 100);
}

/** Paid usage beyond the plan, when the account has it switched on. */
function spendPercent(limits: Json): number | null {
  const spend = limits.spend;
  if (
    isRecord(spend) &&
    spend.enabled === true &&
    isRecord(spend.used) &&
    isRecord(spend.limit)
  ) {
    const { used, limit } = spend;
    // Minor units only compare in the same currency and scale.
    if (used.currency === limit.currency && used.exponent === limit.exponent) {
      const percent = ratio(used.amount_minor, limit.amount_minor);
      if (percent !== null) {
        return percent;
      }
    }
  }
  const extra = limits.extra_usage;
  if (!isRecord(extra) || extra.is_enabled !== true) {
    return null;
  }
  const percent = ratio(extra.used_credits, extra.monthly_limit);
  if (percent !== null) {
    return percent;
  }

  return finite(extra.utilization) && extra.utilization >= 0
    ? clampPercent(extra.utilization)
    : null;
}

export interface ParsedUsage {
  available: boolean;
  subscriptionType: string | null;
  windows: UsageLimitWindow[];
}

/** `get_usage` percentages are already 0–100. */
export function windowsFromUsageResponse(
  response: unknown,
  now: number,
): ParsedUsage {
  const r = isRecord(response) ? response : {};
  const subscriptionType =
    typeof r.subscription_type === "string" ? r.subscription_type : null;
  if (r.rate_limits_available !== true || !isRecord(r.rate_limits)) {
    return { available: false, subscriptionType, windows: [] };
  }
  const limits = r.rate_limits;
  const windows: UsageLimitWindow[] = [];
  for (const [id, meta] of Object.entries(FIXED)) {
    const entry = limits[id];
    if (isRecord(entry) && finite(entry.utilization)) {
      windows.push(
        window(
          {
            id,
            ...meta,
            used: entry.utilization,
            resets_at: parseTime(entry.resets_at),
          },
          now,
        ),
      );
    }
  }
  for (const e of scopedEntries(limits)) {
    windows.push(scoped(e.name, e.used, e.resetsAt, now));
  }
  const spend = spendPercent(limits);
  if (spend !== null) {
    windows.push(
      window(
        {
          id: "monthly_spend",
          kind: "monthly",
          label: "Monthly spend",
          used: spend,
          resets_at: null,
          window_minutes: null,
        },
        now,
      ),
    );
  }

  return { available: true, subscriptionType, windows };
}

/**
 * Fold one streamed `rate_limit_event` into known windows. Utilisation there
 * is 0–1 and the reset is in epoch seconds. Null when it changes nothing.
 */
export function applyRateLimitEvent(
  windows: UsageLimitWindow[],
  line: string,
  now: number,
): UsageLimitWindow[] | null {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return null;
  }
  if (
    !isRecord(msg) ||
    msg.type !== "rate_limit_event" ||
    !isRecord(msg.rate_limit_info)
  ) {
    return null;
  }
  const info = msg.rate_limit_info;
  const type = info.rateLimitType;
  if (typeof type !== "string" || !finite(info.utilization)) {
    return null;
  }
  const used = info.utilization * 100;
  const resetsAt =
    finite(info.resetsAt) && info.resetsAt > 0 ? info.resetsAt * 1000 : null;
  let next: UsageLimitWindow | null = null;
  if (type in FIXED) {
    next = window({ id: type, ...FIXED[type], used, resets_at: resetsAt }, now);
  } else if (type === SCOPED_EVENT_TYPE) {
    // Only a cap the last probe already named can be matched to a row.
    const first = windows.find(
      (w) => w.id.startsWith("seven_day_") && w.label.startsWith("Weekly · "),
    );
    if (first) {
      next = scoped(first.label.slice("Weekly · ".length), used, resetsAt, now);
    }
  }
  if (!next) {
    return null;
  }
  const replaced = next;
  const rest = windows.filter((w) => w.id !== replaced.id);

  return windows.some((w) => w.id === replaced.id)
    ? windows.map((w) => (w.id === replaced.id ? replaced : w))
    : [...rest, replaced];
}
