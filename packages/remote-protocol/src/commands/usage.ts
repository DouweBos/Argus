import type { CommandSpec } from "./spec";
import { z } from "zod";
import { ClaudeUsageLimits } from "../models/usage";

export const USAGE_COMMANDS = {
  /** Plan limits per Claude account; `refresh` skips the minute-long cache. */
  get_claude_usage_limits: {
    tier: "admin",
    params: z.object({ refresh: z.boolean().optional() }),
    result: ClaudeUsageLimits,
  },
} as const satisfies Record<string, CommandSpec>;
