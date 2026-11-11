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

/**
 * Another signed-in Claude account an agent stalled on a usage limit can be
 * handed to. Offered only for the user to pick: Argus never switches by itself.
 */
export const LimitHandoffAccount = z.object({
  account_id: z.string(),
  /** The account's label, else its email. */
  label: z.string(),
  /** The email when it isn't already the label, else the plan; null if neither. */
  detail: z.string().nullable(),
  /** The window closest to its limit; null when the plan's usage isn't known. */
  usage: UsageLimitWindow.nullable(),
});
export type LimitHandoffAccount = z.infer<typeof LimitHandoffAccount>;

/** Plan windows another runner reports: Codex rate limits, Cursor and Grok allowances. */
export const RunnerUsageLimits = z.object({
  runner: z.string(),
  label: z.string(),
  /** `unsupported`: signed out, or signed in a way that has no plan (an API key). */
  status: z.enum(["failed", "ok", "unsupported"]),
  plan: z.string().nullable(),
  /** Why the windows are missing, when the runner said. */
  message: z.string().nullable(),
  windows: z.array(UsageLimitWindow),
  /** Unix ms of the last check. */
  checked_at: z.number(),
});
export type RunnerUsageLimits = z.infer<typeof RunnerUsageLimits>;

export const ClaudeUsageLimits = z.object({
  accounts: z.array(ClaudeAccountLimits),
  /** Installed runners other than Claude; absent from hosts that predate them. */
  runners: z.array(RunnerUsageLimits).optional(),
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
  /** Cost a runner reported for a model without list prices, so it can't be split by kind. */
  other: z.number().optional(),
  /** What fast and ultrafast requests cost above standard rates; included in the kinds above. */
  premium: z.number().optional(),
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
  /** Runner the model was used through. */
  runner: z.string().optional(),
  /** Where its cost comes from: the price list, a price set by hand, the runner's own report. */
  price_source: z.enum(["custom", "list", "none", "reported"]).optional(),
  /** Model ids counted under this one through a price mapping. */
  mapped_from: z.array(z.string()).optional(),
  /** Tokens by kind, for the cache hit rate in the model's detail. */
  token_kinds: UsageTokenTotals.optional(),
  /** Its own trend, lined up with the summary's buckets. */
  series: z.array(UsageSeriesPoint).optional(),
});
export type UsageModelRow = z.infer<typeof UsageModelRow>;

export const UsageSpeed = z.enum(["fast", "standard", "ultrafast"]);
export type UsageSpeed = z.infer<typeof UsageSpeed>;

/** Tokens and cost run at one speed tier; `premium_usd` is its cost above standard rates. */
export const UsageSpeedRow = z.object({
  speed: UsageSpeed,
  tokens: z.number(),
  cost_usd: z.number(),
  premium_usd: z.number(),
});
export type UsageSpeedRow = z.infer<typeof UsageSpeedRow>;

/** One runner's share of a range; `series` lines up with the summary's buckets. */
export const UsageRunnerRow = z.object({
  runner: z.string(),
  label: z.string(),
  sessions: z.number(),
  tokens: z.number(),
  cost_usd: z.number(),
  /** False when none of its models are priced and it reported no cost. */
  priced: z.boolean(),
  series: z.array(UsageSeriesPoint),
});
export type UsageRunnerRow = z.infer<typeof UsageRunnerRow>;

/**
 * Usage on this machine across runners: Claude Code and Codex from their own
 * session files, the other runners from what Argus recorded per turn.
 */
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
  /** Per runner, most expensive first; absent from hosts that predate it. */
  runners: z.array(UsageRunnerRow).optional(),
  /** Per speed tier with any use; absent when everything ran at standard speed. */
  speeds: z.array(UsageSpeedRow).optional(),
  /** Unix ms the price list was fetched; null when none is available yet. */
  prices_fetched_at: z.number().nullable(),
});
export type ClaudeUsageSummary = z.infer<typeof ClaudeUsageSummary>;

/**
 * A model's price set by hand, in USD per million tokens; it replaces the list
 * price for all history. `map_to` counts the model as another one instead.
 */
export const UsagePriceOverride = z.object({
  model: z.string().min(1),
  input_per_mtok: z.number().min(0).nullable(),
  output_per_mtok: z.number().min(0).nullable(),
  /** Null falls back to the input rate. */
  cache_read_per_mtok: z.number().min(0).nullable(),
  cache_write_per_mtok: z.number().min(0).nullable(),
  map_to: z.string().min(1).nullable(),
});
export type UsagePriceOverride = z.infer<typeof UsagePriceOverride>;

/** One model's list price, per million tokens, for the price editor to start from. */
export const UsageListPrice = z.object({
  model: z.string(),
  input_per_mtok: z.number(),
  output_per_mtok: z.number(),
  cache_read_per_mtok: z.number(),
  cache_write_per_mtok: z.number(),
});
export type UsageListPrice = z.infer<typeof UsageListPrice>;

export const UsagePrices = z.object({
  overrides: z.array(UsagePriceOverride),
  /** List prices for the models seen in the last 90 days, so the editor can show what it replaces. */
  list: z.array(UsageListPrice),
});
export type UsagePrices = z.infer<typeof UsagePrices>;

/** Which models Usage counts; `runner` scopes a rule to one runner, else it matches any. */
export const UsageModelRule = z.object({
  runner: z.string().nullable(),
  model: z.string().min(1),
});
export type UsageModelRule = z.infer<typeof UsageModelRule>;

export const UsageModelFilter = z.object({
  /** Non-empty: count only these. */
  include: z.array(UsageModelRule),
  exclude: z.array(UsageModelRule),
});
export type UsageModelFilter = z.infer<typeof UsageModelFilter>;
