import { getClaudeUsageLimits } from "../services/claudeUsage/limits";
import { defineTypedCommand } from "../services/command/registry";

export function registerUsageCommands(): void {
  defineTypedCommand("get_claude_usage_limits", (p) =>
    getClaudeUsageLimits(p.refresh ?? false),
  );
}
