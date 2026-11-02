import { GaugeIcon, WarningIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { Card } from "../Card/Card";
import { EmptyState } from "../EmptyState/EmptyState";
import { ProgressBar } from "../ProgressBar/ProgressBar";
import { SectionPanel } from "../SectionPanel/SectionPanel";
import { SeriesChart } from "../SeriesChart/SeriesChart";
import { Spinner } from "../Spinner/Spinner";
import { StackedBar } from "../StackedBar/StackedBar";
import { StatCell, StatsStrip } from "../StatsStrip/StatsStrip";
import styles from "./UsageSummary.module.css";

export interface UsageModelRowData {
  model: string;
  cost: string;
  share: string;
  tokens: string;
  progress: number;
  priced: boolean;
}

/** One range of cost or tokens, from `usageSummaryView` in `@argus/client-core`. */
export interface UsageSummaryData {
  empty: boolean;
  headline: string;
  caption: string;
  pricesPending: boolean;
  chart: {
    caption: string;
    labels: string[];
    values: number[];
    kind: "bar" | "line";
    formatValue: (value: number) => string;
  };
  totals: { label: string; value: string }[];
  parts: {
    caption: string;
    segments: {
      label: string;
      value: number;
      display: string;
      detail: string;
    }[];
  };
  models: UsageModelRowData[];
  hasUnpriced: boolean;
}

export interface UsageSummaryPanelProps {
  /** Only ever the range asked for; null while it loads. */
  summary: UsageSummaryData | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  retrying: boolean;
}

function Breakdown({
  models,
  unpriced,
}: {
  models: UsageModelRowData[];
  unpriced: boolean;
}) {
  return (
    <div className={styles.breakdown}>
      <div className={`${styles.row} ${styles.headRow}`}>
        <span>Model</span>
        <span className={styles.num}>Cost</span>
        <span className={styles.num}>Share</span>
        <span className={styles.num}>Tokens</span>
      </div>
      {models.map((m) => (
        <div className={styles.row} key={m.model}>
          <span className={styles.model}>
            <span className={styles.modelName}>{m.model}</span>
            <ProgressBar
              aria-label={`${m.model} share`}
              progress={m.progress}
              size="xs"
            />
          </span>
          <span
            className={styles.num}
            title={m.priced ? undefined : "Not in the price list"}
          >
            {m.cost}
          </span>
          <span className={styles.num}>{m.share}</span>
          <span className={styles.num}>{m.tokens}</span>
        </div>
      ))}
      {unpriced && (
        <p className={styles.note}>
          — marks models the price list doesn’t cover; their tokens still count.
        </p>
      )}
    </div>
  );
}

/** Cost or tokens over a range: headline, chart, totals, parts and per model. */
export function UsageSummaryPanel({
  summary,
  loading,
  error,
  onRetry,
  retrying,
}: UsageSummaryPanelProps) {
  if (!summary) {
    if (loading) {
      return (
        <div className={styles.loading}>
          <Spinner />
          <span>Reading Claude Code sessions…</span>
        </div>
      );
    }

    return (
      <EmptyState
        action={
          <Button disabled={retrying} onClick={onRetry} size="sm">
            Try again
          </Button>
        }
        body={error ?? undefined}
        icon={<WarningIcon size={18} />}
        title="Couldn't read usage"
      />
    );
  }

  if (summary.empty) {
    return (
      <EmptyState
        body="No Claude Code sessions on this machine in this period."
        icon={<GaugeIcon size={18} />}
        title="No usage yet"
      />
    );
  }

  return (
    <div className={styles.summary}>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.headline}>
        <span className={styles.total}>{summary.headline}</span>
        <span className={styles.caption}>{summary.caption}</span>
      </div>
      {summary.pricesPending && (
        <p className={styles.note}>
          Costs appear once the price list downloads.
        </p>
      )}

      <Card>
        <SeriesChart
          caption={summary.chart.caption}
          formatValue={summary.chart.formatValue}
          kind={summary.chart.kind}
          labels={summary.chart.labels}
          values={summary.chart.values}
        />
      </Card>

      <SectionPanel plain title="Totals">
        <StatsStrip>
          {summary.totals.map((t) => (
            <StatCell key={t.label} label={t.label} value={t.value} />
          ))}
        </StatsStrip>
      </SectionPanel>

      <Card>
        <StackedBar
          caption={summary.parts.caption}
          segments={summary.parts.segments}
        />
      </Card>

      <SectionPanel plain title="By model">
        <Breakdown models={summary.models} unpriced={summary.hasUnpriced} />
      </SectionPanel>
    </div>
  );
}
