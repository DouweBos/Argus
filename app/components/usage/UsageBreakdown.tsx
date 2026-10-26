import type { MetricView } from "./summaryMetric";
import type { UsageModelRow } from "../../lib/types";
import { ProgressBar } from "@argus/peacock";
import { formatShare, formatTokens, formatUsd } from "../../lib/usageFormat";
import styles from "./UsageSummary.module.css";

interface UsageBreakdownProps {
  metric: MetricView;
  models: UsageModelRow[];
  /** The headline total shares are measured against. */
  total: number;
}

/** Per-model table, largest first: value, share of the total, and tokens. */
export function UsageBreakdown({ models, metric, total }: UsageBreakdownProps) {
  const rows = [...models].sort(
    (a, b) => (metric.modelValue(b) ?? -1) - (metric.modelValue(a) ?? -1),
  );
  const unpriced = rows.some((m) => !m.priced);

  return (
    <div className={styles.breakdown}>
      <div className={`${styles.row} ${styles.headRow}`}>
        <span>Model</span>
        <span className={styles.num}>Cost</span>
        <span className={styles.num}>Share</span>
        <span className={styles.num}>Tokens</span>
      </div>
      {rows.map((m) => {
        const value = metric.modelValue(m);

        return (
          <div className={styles.row} key={m.model}>
            <span className={styles.model}>
              <span className={styles.modelName}>{m.model}</span>
              <ProgressBar
                aria-label={`${m.model} share`}
                progress={value !== null && total > 0 ? value / total : 0}
                size="xs"
              />
            </span>
            <span
              className={styles.num}
              title={m.priced ? undefined : "Not in the price list"}
            >
              {m.priced ? formatUsd(m.cost_usd) : "—"}
            </span>
            <span className={styles.num}>
              {value === null ? "—" : formatShare(value, total)}
            </span>
            <span className={styles.num}>{formatTokens(m.tokens)}</span>
          </div>
        );
      })}
      {unpriced && (
        <p className={styles.note}>
          — marks models the price list doesn’t cover; their tokens still count.
        </p>
      )}
    </div>
  );
}
