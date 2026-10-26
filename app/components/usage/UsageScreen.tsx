import type { UsageRange, UsageTab } from "../../lib/router";
import { Button, Icons, SegmentedControl } from "@argus/peacock";
import { useRouteUsageRange, useRouteUsageTab } from "../../lib/routeHooks";
import { openUsage, setUsageRange } from "../../stores/centerViewStore";
import { LimitsTab } from "./LimitsTab";
import { SummaryView } from "./SummaryView";
import styles from "./UsageScreen.module.css";
import { useUsageLimits } from "./useUsageLimits";
import { useUsageSummary } from "./useUsageSummary";

const TABS: { label: string; value: UsageTab }[] = [
  { label: "Limits", value: "limits" },
  { label: "Cost", value: "cost" },
  { label: "Tokens", value: "tokens" },
];

const RANGES: { label: string; value: UsageRange }[] = [
  { label: "Past 24h", value: "24h" },
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
  { label: "90 days", value: "90d" },
];

/** `/usage` — what your Claude plans allow and what you've spent, one tab per angle on it. */
export function UsageScreen() {
  const tab = useRouteUsageTab();
  const range = useRouteUsageRange();
  const limits = useUsageLimits();
  const summary = useUsageSummary(range, tab !== "limits");
  const active = tab === "limits" ? limits : summary;
  const handleRefresh = active.refresh;
  const plan =
    limits.data?.accounts.length === 1
      ? limits.data.accounts[0]?.subscription_type
      : null;

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <div className={styles.titleRow}>
          <h1 className={styles.titleHeading}>Usage</h1>
          {plan && <span className={styles.sub}>{plan}</span>}
        </div>
        <Button
          disabled={active.refreshing || active.loading}
          leading={<Icons.RefreshIcon size={12} />}
          onClick={handleRefresh}
          size="sm"
          variant="secondary"
        >
          Refresh
        </Button>
      </header>

      <div className={styles.controls}>
        <SegmentedControl
          aria-label="Usage view"
          onChange={(next) => openUsage(next)}
          options={TABS}
          value={tab}
        />
        {tab !== "limits" && (
          <SegmentedControl
            aria-label="Time range"
            onChange={setUsageRange}
            options={RANGES}
            value={range}
          />
        )}
      </div>

      {tab === "limits" ? (
        <LimitsTab limits={limits} />
      ) : (
        <SummaryView metric={tab} summary={summary} />
      )}
    </div>
  );
}
