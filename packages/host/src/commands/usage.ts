import { defineTypedCommand } from "../services/command/registry";
import { getUsageLimits } from "../services/usage/runnerLimits";
import { getClaudeUsageSummary } from "../services/usage/summary";
import { getUsagePrices, setUsagePrices } from "../services/usage/usagePrices";

export function registerUsageCommands(): void {
  defineTypedCommand("get_claude_usage_limits", (p) =>
    getUsageLimits(p.refresh ?? false),
  );
  defineTypedCommand("get_claude_usage_summary", (p) =>
    getClaudeUsageSummary(p.range),
  );
  defineTypedCommand("get_usage_prices", () => getUsagePrices());
  defineTypedCommand("set_usage_prices", (p) => setUsagePrices(p.overrides));
}
