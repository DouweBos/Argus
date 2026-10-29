import { PlanLimitsStrip } from "@argus/peacock";
import { compactLimits, worstTone } from "../../../lib/compactLimits";
import { capture } from "../../../lib/telemetry";
import { openUsage } from "../../../stores/centerViewStore";
import { useUsageLimits } from "../../usage/useUsageLimits";

const LEVELS = {
  accent: "normal",
  warning: "warning",
  danger: "critical",
} as const;

/** Plan limits at a glance; nothing at all until there is something to show. */
export function HomeUsage({ className }: { className?: string }) {
  const { data, now } = useUsageLimits();
  const limits = compactLimits(data, now);
  if (limits.length === 0) {
    return null;
  }

  return (
    <PlanLimitsStrip
      aria-label="Plan limits — open usage"
      className={className}
      limits={limits}
      onClick={() => {
        capture("home_usage_opened", { level: LEVELS[worstTone(limits)] });
        openUsage("limits");
      }}
    />
  );
}
