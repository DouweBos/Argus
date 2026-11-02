import type { ReactNode } from "react";
import { RefreshIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { SegmentedControl } from "../SegmentedControl/SegmentedControl";
import styles from "./UsageScreen.module.css";

export type UsageScreenTab = "cost" | "limits" | "tokens";
export type UsageScreenRange = "7d" | "24h" | "30d" | "90d";

const TABS: { label: string; value: UsageScreenTab }[] = [
  { label: "Limits", value: "limits" },
  { label: "Cost", value: "cost" },
  { label: "Tokens", value: "tokens" },
];

const RANGES: { label: string; value: UsageScreenRange }[] = [
  { label: "Past 24h", value: "24h" },
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
  { label: "90 days", value: "90d" },
];

export interface UsageScreenProps {
  tab: UsageScreenTab;
  range: UsageScreenRange;
  onTabChange: (tab: UsageScreenTab) => void;
  onRangeChange: (range: UsageScreenRange) => void;
  /** The plan beside the title, when one account is signed in. */
  plan?: string | null;
  onRefresh: () => void;
  refreshing: boolean;
  /** Hide the "Usage" heading when the surrounding chrome already says it. */
  hideTitle?: boolean;
  /** `UsageLimitsPanel` or `UsageSummaryPanel`, for the tab. */
  children: ReactNode;
}

/** What your Claude plans allow and what you've spent, one tab per angle on it. */
export function UsageScreen({
  tab,
  range,
  onTabChange,
  onRangeChange,
  plan,
  onRefresh,
  refreshing,
  hideTitle = false,
  children,
}: UsageScreenProps) {
  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <div className={styles.titleRow}>
          {!hideTitle && <h1 className={styles.titleHeading}>Usage</h1>}
          {plan && <span className={styles.sub}>{plan}</span>}
        </div>
        <Button
          disabled={refreshing}
          leading={<RefreshIcon size={12} />}
          onClick={onRefresh}
          size="sm"
          variant="secondary"
        >
          Refresh
        </Button>
      </header>

      <div className={styles.controls}>
        <SegmentedControl
          aria-label="Usage view"
          onChange={onTabChange}
          options={TABS}
          value={tab}
        />
        {tab !== "limits" && (
          <SegmentedControl
            aria-label="Time range"
            onChange={onRangeChange}
            options={RANGES}
            value={range}
          />
        )}
      </div>

      {children}
    </div>
  );
}
