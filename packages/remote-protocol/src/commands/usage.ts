import type { CommandSpec } from "./spec";
import { z } from "zod";
import {
  ClaudeUsageLimits,
  ClaudeUsageSummary,
  UsageRange,
} from "../models/usage";

export const USAGE_COMMANDS = {
  /** Plan limits per Claude account and per other runner; `refresh` skips the minute-long cache. */
  get_claude_usage_limits: {
    tier: "admin",
    params: z.object({ refresh: z.boolean().optional() }),
    result: ClaudeUsageLimits,
  },
  /** Tokens and estimated cost on this machine, split by runner. */
  get_claude_usage_summary: {
    tier: "admin",
    params: z.object({ range: UsageRange }),
    result: ClaudeUsageSummary,
  },
} as const satisfies Record<string, CommandSpec>;
