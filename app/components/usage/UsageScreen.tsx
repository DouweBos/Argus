import type { UsageTab } from "../../lib/router";
import { Button, Icons, SegmentedControl } from "@argus/peacock";
import { useRouteUsageTab } from "../../lib/routeHooks";
import { openUsage } from "../../stores/centerViewStore";
import { LimitsTab } from "./LimitsTab";
import styles from "./UsageScreen.module.css";
import { useUsageLimits } from "./useUsageLimits";

const TABS: { label: string; value: UsageTab }[] = [
  { label: "Limits", value: "limits" },
];

/** `/usage` — what your Claude plans allow, one tab per angle on it. */
export function UsageScreen() {
  const tab = useRouteUsageTab();
  const limits = useUsageLimits();
  const handleRefresh = limits.refresh;
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
          disabled={limits.refreshing || limits.loading}
          leading={<Icons.RefreshIcon size={12} />}
          onClick={handleRefresh}
          size="sm"
          variant="secondary"
        >
          Refresh
        </Button>
      </header>

      <SegmentedControl
        aria-label="Usage view"
        className={styles.tabs}
        onChange={(next) => openUsage(next)}
        options={TABS}
        value={tab}
      />

      <LimitsTab limits={limits} />
    </div>
  );
}
