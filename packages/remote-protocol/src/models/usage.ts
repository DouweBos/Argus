import { z } from "zod";

/** How fast a window is being spent against how much of it has passed. */
export const UsagePace = z.enum(["ahead", "on", "under"]);
export type UsagePace = z.infer<typeof UsagePace>;

/** One plan limit: the 5-hour session, a weekly cap, or monthly spend. */
export const UsageLimitWindow = z.object({
  id: z.string(),
  kind: z.enum(["monthly", "session", "weekly"]),
  label: z.string(),
  /** 0–100. */
  used_percent: z.number(),
  /** Unix ms; null when the plan didn't say. */
  resets_at: z.number().nullable(),
  /** Length of the window; null for spend, which has no fixed window. */
  window_minutes: z.number().nullable(),
  pace: UsagePace.nullable(),
});
export type UsageLimitWindow = z.infer<typeof UsageLimitWindow>;

export const ClaudeAccountLimits = z.object({
  account_id: z.string(),
  /** The account's label, else its email. */
  label: z.string(),
  /** `unsupported`: API-key or console accounts have no plan limits. */
  status: z.enum(["failed", "ok", "unsupported"]),
  subscription_type: z.string().nullable(),
  windows: z.array(UsageLimitWindow),
  /** Unix ms of the last probe. */
  checked_at: z.number(),
});
export type ClaudeAccountLimits = z.infer<typeof ClaudeAccountLimits>;

export const ClaudeUsageLimits = z.object({
  accounts: z.array(ClaudeAccountLimits),
});
export type ClaudeUsageLimits = z.infer<typeof ClaudeUsageLimits>;

export const UsageRange = z.enum(["24h", "7d", "30d", "90d"]);
export type UsageRange = z.infer<typeof UsageRange>;

/** Tokens by kind; `processed` is all four together. */
export const UsageTokenTotals = z.object({
  processed: z.number(),
  input: z.number(),
  cache_read: z.number(),
  cache_write: z.number(),
  output: z.number(),
});
export type UsageTokenTotals = z.infer<typeof UsageTokenTotals>;

/** Estimated dollars at API list prices, by the same kinds. */
export const UsageCostTotals = z.object({
  total: z.number(),
  input: z.number(),
  cache_read: z.number(),
  cache_write: z.number(),
  output: z.number(),
});
export type UsageCostTotals = z.infer<typeof UsageCostTotals>;

export const UsageSeriesPoint = z.object({
  /** Unix ms at the start of the hour or local day. */
  start: z.number(),
  tokens: z.number(),
  cost_usd: z.number(),
});
export type UsageSeriesPoint = z.infer<typeof UsageSeriesPoint>;

export const UsageModelRow = z.object({
  model: z.string(),
  tokens: z.number(),
  cost_usd: z.number(),
  /** False when the price list doesn't know the model: tokens count, cost doesn't. */
  priced: z.boolean(),
});
export type UsageModelRow = z.infer<typeof UsageModelRow>;

/** Claude Code usage on this machine, read from its session transcripts. */
export const ClaudeUsageSummary = z.object({
  range: UsageRange,
  since: z.number(),
  until: z.number(),
  bucket: z.enum(["day", "hour"]),
  sessions: z.number(),
  tokens: UsageTokenTotals,
  cost: UsageCostTotals,
  /** What cache reads saved against paying the input rate. */
  cache_savings_usd: z.number(),
  series: z.array(UsageSeriesPoint),
  models: z.array(UsageModelRow),
  /** Unix ms the price list was fetched; null when none is available yet. */
  prices_fetched_at: z.number().nullable(),
});
export type ClaudeUsageSummary = z.infer<typeof ClaudeUsageSummary>;
