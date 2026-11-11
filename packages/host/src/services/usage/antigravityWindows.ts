/**
 * Plan windows from Antigravity's Cloud Code quota answers: the quota summary,
 * or per-model quotas on accounts that predate it.
 */

import type { UsageLimitWindow } from "@argus/remote-protocol";
import { makeWindow } from "./runnerWindows";

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const WINDOW_MINUTES: Record<string, number> = {
  "5h": 5 * 60,
  weekly: 7 * 24 * 60,
};

const WINDOW_NAMES: Record<string, string> = {
  "5h": "Session",
  weekly: "Weekly",
};

function quotaWindow(
  w: {
    id: string;
    label: string;
    kind: UsageLimitWindow["kind"];
    remaining: unknown;
    resetTime: string;
    minutes: number | null;
  },
  now: number,
): UsageLimitWindow | null {
  if (typeof w.remaining !== "number" || !Number.isFinite(w.remaining)) {
    return null;
  }
  const reset = w.resetTime ? Date.parse(w.resetTime) : NaN;

  return makeWindow(
    {
      id: w.id,
      label: w.label,
      kind: w.kind,
      used: (1 - Math.min(1, Math.max(0, w.remaining))) * 100,
      resetsAt: Number.isFinite(reset) ? reset : null,
      minutes: w.minutes,
    },
    now,
  );
}

/** Gemini Argon and Carbon are metered apart from the default Gemini buckets. */
function bucketFamily(bucketId: string, group: string): string {
  if (bucketId.startsWith("gemini-argon-")) {
    return group || "Gemini Argon";
  }
  if (bucketId.startsWith("gemini-carbon-")) {
    return group || "Gemini Carbon";
  }
  if (bucketId.startsWith("gemini-")) {
    return "Gemini";
  }
  if (bucketId.startsWith("3p-")) {
    return "Claude & GPT";
  }

  return group || bucketId;
}

/** `retrieveUserQuotaSummary`, answered at `requestedAt`. */
export function antigravitySummaryWindows(
  raw: unknown,
  requestedAt: number,
  now: number,
): UsageLimitWindow[] {
  if (!isRecord(raw)) {
    return [];
  }
  const groups = Array.isArray(raw.groups) ? raw.groups.filter(isRecord) : [];
  const grouped = groups.some(
    (g) => Array.isArray(g.buckets) && g.buckets.length > 0,
  );
  const sources = grouped ? groups : [{ buckets: raw.buckets }];
  const windows = new Map<string, UsageLimitWindow>();
  for (const group of sources) {
    const buckets = Array.isArray(group.buckets)
      ? group.buckets.filter(isRecord)
      : [];
    for (const bucket of buckets) {
      const id = text(bucket.bucketId);
      if (!id || bucket.disabled === true) {
        continue;
      }
      const span = text(bucket.window);
      const minutes = WINDOW_MINUTES[span] ?? null;
      let resetTime = text(bucket.resetTime);
      // An untouched bucket reports a full window from now, which isn't a real reset.
      if (
        bucket.remainingFraction === 1 &&
        bucket.description === undefined &&
        minutes !== null &&
        Math.abs(Date.parse(resetTime) - requestedAt - minutes * 60_000) <=
          60_000
      ) {
        resetTime = "";
      }
      const name = WINDOW_NAMES[span] ?? (text(bucket.displayName) || "Quota");
      const window = quotaWindow(
        {
          id,
          label: `${bucketFamily(id, text(group.displayName))} · ${name}`,
          kind: span === "weekly" ? "weekly" : "session",
          remaining: bucket.remainingFraction,
          resetTime,
          minutes,
        },
        now,
      );
      if (window && !windows.has(id)) {
        windows.set(id, window);
      }
    }
  }

  return [...windows.values()];
}

function modelFamily(modelId: string, provider: string): string | null {
  if (provider === "MODEL_PROVIDER_GOOGLE" || modelId.startsWith("gemini-")) {
    return "Gemini";
  }
  if (
    provider === "MODEL_PROVIDER_ANTHROPIC" ||
    modelId.startsWith("claude-")
  ) {
    return "Claude";
  }
  if (provider === "MODEL_PROVIDER_OPENAI" || modelId.startsWith("gpt-")) {
    return "GPT";
  }

  return null;
}

/** `fetchAvailableModels`: the most-used model per family, with no window length for the short quota. */
export function antigravityModelWindows(
  raw: unknown,
  now: number,
): UsageLimitWindow[] {
  const models = isRecord(raw) && isRecord(raw.models) ? raw.models : {};
  const windows = new Map<string, UsageLimitWindow>();
  for (const [modelId, model] of Object.entries(models)) {
    const family = isRecord(model)
      ? modelFamily(modelId, text(model.modelProvider))
      : null;
    if (!family || !isRecord(model)) {
      continue;
    }
    for (const [suffix, quota] of [
      ["quota", model.quotaInfo],
      ["weekly", model.weeklyQuotaInfo],
    ] as const) {
      if (!isRecord(quota)) {
        continue;
      }
      const weekly = suffix === "weekly";
      const window = quotaWindow(
        {
          id: `${family.toLowerCase()}-${suffix}`,
          label: `${family} · ${weekly ? "Weekly" : "Quota"}`,
          kind: weekly ? "weekly" : "session",
          remaining: quota.remainingFraction,
          resetTime: text(quota.resetTime),
          minutes: weekly ? WINDOW_MINUTES.weekly : null,
        },
        now,
      );
      const previous = window && windows.get(window.id);
      if (
        window &&
        (!previous || window.used_percent > previous.used_percent)
      ) {
        windows.set(window.id, window);
      }
    }
  }

  return [...windows.values()];
}
