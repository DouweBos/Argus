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
