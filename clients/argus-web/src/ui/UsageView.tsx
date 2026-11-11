/**
 * `/usage[/:tab]?range=`: the computer's plan limits per Claude account and
 * runner, and its cost and tokens over a range, split by runner. The tab and range live in the URL.
 */

import { useEffect, useMemo } from "react";
import {
  loadPhase,
  usageAccountViews,
  usagePlan,
  usageRunnerLimitViews,
  usageSummaryView,
  type UsageRange,
  type UsageTab,
} from "@argus/client-core";
import {
  UsageLimitsPanel,
  UsageScreen,
  UsageSummaryPanel,
} from "@argus/peacock";
import { appNavigate } from "../routing/router";
import { useConnectionStore } from "../stores/connection";
import { useUsageStore } from "../stores/usage";

/** The host caches limits for a minute; summaries are a scan, so poll slower. */
const LIMITS_POLL_MS = 60_000;
const SUMMARY_POLL_MS = 5 * 60_000;

export function UsageView({
  tab,
  range,
}: {
  tab: UsageTab;
  range: UsageRange;
}) {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const usage = useUsageStore();
  const { loadLimits, loadSummary } = usage;
  const summaryTab = tab === "limits" ? null : tab;

  useEffect(() => {
    if (!ready || summaryTab) {
      return;
    }
    loadLimits().catch(() => {});
    const timer = setInterval(
      () => loadLimits({ background: true }).catch(() => {}),
      LIMITS_POLL_MS,
    );

    return () => clearInterval(timer);
  }, [ready, summaryTab, loadLimits]);

  useEffect(() => {
    if (!ready || !summaryTab) {
      return;
    }
    loadSummary(range).catch(() => {});
    const timer = setInterval(
      () => loadSummary(range, { background: true }).catch(() => {}),
      SUMMARY_POLL_MS,
    );

    return () => clearInterval(timer);
  }, [ready, summaryTab, range, loadSummary]);

  const accounts = useMemo(
    () =>
      usage.limits ? usageAccountViews(usage.limits, usage.limitsAt) : null,
    [usage.limits, usage.limitsAt],
  );
  const runners = useMemo(
    () =>
      usage.limits ? usageRunnerLimitViews(usage.limits, usage.limitsAt) : [],
    [usage.limits, usage.limitsAt],
  );
  const summary = usage.summaries[range];
  const summaryView = useMemo(
    () =>
      summary && summaryTab ? usageSummaryView(summary, summaryTab) : null,
    [summary, summaryTab],
  );
  const summaryLoad = usage.summaryLoad[range] ?? {
    loaded: false,
    error: null,
  };
  const limitsPhase = loadPhase(usage.limitsLoad, accounts === null);
  const summaryPhase = loadPhase(summaryLoad, summaryView === null);

  return (
    <div className="aw-flush">
      <UsageScreen
        hideTitle
        plan={usagePlan(usage.limits)}
        range={range}
        refreshing={
          summaryTab ? usage.summaryRefreshing : usage.limitsRefreshing
        }
        tab={tab}
        onRangeChange={(next) =>
          appNavigate({ name: "usage", tab, range: next }, { replace: true })
        }
        onRefresh={() => {
          (summaryTab ? loadSummary(range) : loadLimits({ force: true })).catch(
            () => {},
          );
        }}
        onTabChange={(next) => appNavigate({ name: "usage", tab: next, range })}
      >
        {summaryTab ? (
          <UsageSummaryPanel
            error={summaryLoad.error}
            loading={summaryPhase.kind === "loading"}
            retrying={usage.summaryRefreshing}
            summary={summaryView}
            onRetry={() => {
              loadSummary(range).catch(() => {});
            }}
          />
        ) : (
          <UsageLimitsPanel
            accounts={accounts}
            error={usage.limitsLoad.error}
            loading={limitsPhase.kind === "loading"}
            noAccountHint="Sign in to Claude under Settings → Claude Accounts, or to a runner with a plan, to see its limits here."
            retrying={usage.limitsRefreshing}
            runners={runners}
            onRetry={() => {
              loadLimits({ force: true }).catch(() => {});
            }}
          />
        )}
      </UsageScreen>
    </div>
  );
}
