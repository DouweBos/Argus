import { useMemo } from "react";
import {
  usageAccountViews,
  usagePlan,
  usageSummaryView,
} from "@argus/client-core";
import {
  UsageLimitsPanel,
  UsageScreen as UsageScreenView,
  UsageSummaryPanel,
} from "@argus/peacock";
import { useRouteUsageRange, useRouteUsageTab } from "../../lib/routeHooks";
import { openUsage, setUsageRange } from "../../stores/centerViewStore";
import { useUsageLimits } from "./useUsageLimits";
import { useUsageSummary } from "./useUsageSummary";

/** `/usage` — what your Claude plans allow and what you've spent, one tab per angle on it. */
export function UsageScreen() {
  const tab = useRouteUsageTab();
  const range = useRouteUsageRange();
  const limits = useUsageLimits();
  const summary = useUsageSummary(range, tab !== "limits");
  const active = tab === "limits" ? limits : summary;
  const accounts = useMemo(
    () => (limits.data ? usageAccountViews(limits.data, limits.now) : null),
    [limits.data, limits.now],
  );
  const summaryView = useMemo(
    () =>
      summary.data && tab !== "limits"
        ? usageSummaryView(summary.data, tab)
        : null,
    [summary.data, tab],
  );

  const handleRefresh = active.refresh;
  const handleRetryLimits = limits.refresh;
  const handleRetrySummary = summary.refresh;

  return (
    <UsageScreenView
      plan={usagePlan(limits.data)}
      range={range}
      refreshing={active.refreshing || active.loading}
      tab={tab}
      onRangeChange={setUsageRange}
      onRefresh={handleRefresh}
      onTabChange={(next) => openUsage(next)}
    >
      {tab === "limits" ? (
        <UsageLimitsPanel
          accounts={accounts}
          error={limits.error}
          loading={limits.loading}
          retrying={limits.refreshing}
          onRetry={handleRetryLimits}
        />
      ) : (
        <UsageSummaryPanel
          error={summary.error}
          loading={summary.loading}
          retrying={summary.refreshing}
          summary={summaryView}
          onRetry={handleRetrySummary}
        />
      )}
    </UsageScreenView>
  );
}
