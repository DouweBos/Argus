import { getClaudeUsageLimits } from "../services/claudeUsage/limits";
import { getClaudeUsageSummary } from "../services/claudeUsage/summary";
import { defineTypedCommand } from "../services/command/registry";

export function registerUsageCommands(): void {
  defineTypedCommand("get_claude_usage_limits", (p) =>
    getClaudeUsageLimits(p.refresh ?? false),
  );
  defineTypedCommand("get_claude_usage_summary", (p) =>
    getClaudeUsageSummary(p.range),
  );
}
