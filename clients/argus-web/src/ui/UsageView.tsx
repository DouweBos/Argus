/**
 * `/usage[/:tab]?range=`: the computer's plan limits per Claude account and
 * runner, and its cost and tokens over a range, split by runner. With a
 * `model` it is `/usage/:tab/models/:runner/:model`, that model's detail.
 * The tab, range and model live in the URL.
 */

import { useCallback, useEffect, useMemo } from "react";
import {
  claudePoolAccounts,
  findUsageModel,
  loadPhase,
  usageAccountViews,
  usageModelDetailView,
  usagePlan,
  usagePoolViews,
  usageRunnerLimitViews,
  usageSummaryView,
  type UsageModelRef,
  type UsageRange,
  type UsageTab,
} from "@argus/client-core";
import {
  UsageLimitsPanel,
  UsageModelDetail,
  UsageScreen,
  UsageSummaryPanel,
} from "@argus/peacock";
import { appNavigate, navigateBack } from "../routing/router";
import { HOME, type Screen } from "../routing/screens";
import { useConnectionStore } from "../stores/connection";
import { useUsageStore } from "../stores/usage";
import { useUsageShortcuts } from "./useUsageShortcuts";

/** The host caches limits for a minute; summaries are a scan, so poll slower. */
const LIMITS_POLL_MS = 60_000;
const SUMMARY_POLL_MS = 5 * 60_000;

function screenFor(
  tab: UsageTab,
  range: UsageRange,
  model: UsageModelRef | null,
): Screen {
  return model && tab !== "limits"
    ? { name: "usageModel", tab, range, ...model }
    : { name: "usage", tab, range };
}

export function UsageView({
  tab,
  range,
  model = null,
}: {
  tab: UsageTab;
  range: UsageRange;
  model?: UsageModelRef | null;
}) {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const hasControl = useConnectionStore((s) => s.hasControl());
  const usage = useUsageStore();
  const { loadLimits, loadSummary, seedPrices } = usage;
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
  const pools = useMemo(
    () =>
      usage.limits
        ? usagePoolViews(
            claudePoolAccounts(usage.limits.accounts),
            usage.limitsAt,
          )
        : null,
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
  const modelDetail = useMemo(() => {
    const row = summary && model ? findUsageModel(summary, model) : null;

    return summary && row && summaryTab
      ? usageModelDetailView(summary, row, summaryTab)
      : null;
  }, [summary, model, summaryTab]);
  const summaryLoad = usage.summaryLoad[range] ?? {
    loaded: false,
    error: null,
  };
  const limitsPhase = loadPhase(usage.limitsLoad, accounts === null);
  const summaryPhase = loadPhase(summaryLoad, summaryView === null);

  const goTab = useCallback(
    (next: UsageTab) => appNavigate(screenFor(next, range, model)),
    [range, model],
  );
  const goRange = useCallback(
    (next: UsageRange) =>
      appNavigate(screenFor(tab, next, model), { replace: true }),
    [tab, model],
  );
  const goBack = useCallback(
    () =>
      navigateBack(model ? { name: "usage", tab, range } : HOME),
    [model, tab, range],
  );
  useUsageShortcuts({ tab, onTab: goTab, onRange: goRange, onBack: goBack });

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
        onPrices={() => appNavigate({ name: "usagePrices" })}
        onRangeChange={goRange}
        onRefresh={() => {
          (summaryTab ? loadSummary(range) : loadLimits({ force: true })).catch(
            () => {},
          );
        }}
        onTabChange={goTab}
      >
        {summaryTab && model ? (
          <UsageModelDetail
            detail={modelDetail}
            loading={summaryPhase.kind === "loading"}
            onBack={goBack}
            onSetPrice={
              hasControl
                ? () => {
                    seedPrices(model.model);
                    appNavigate({ name: "usagePrices" });
                  }
                : undefined
            }
          />
        ) : summaryTab ? (
          <UsageSummaryPanel
            error={summaryLoad.error}
            loading={summaryPhase.kind === "loading"}
            retrying={usage.summaryRefreshing}
            summary={summaryView}
            onModelSelect={(id) => {
              const row = summaryView?.models.find((m) => m.id === id);
              if (row) {
                appNavigate(
                  screenFor(summaryTab, range, {
                    runner: row.runner,
                    model: row.modelId,
                  }),
                );
              }
            }}
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
            pools={pools}
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
