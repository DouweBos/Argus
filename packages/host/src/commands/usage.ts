import { defineTypedCommand } from "../services/command/registry";
import { getUsageLimits } from "../services/usage/runnerLimits";
import { getClaudeUsageSummary } from "../services/usage/summary";

export function registerUsageCommands(): void {
  defineTypedCommand("get_claude_usage_limits", (p) =>
    getUsageLimits(p.refresh ?? false),
  );
  defineTypedCommand("get_claude_usage_summary", (p) =>
    getClaudeUsageSummary(p.range),
  );
}
