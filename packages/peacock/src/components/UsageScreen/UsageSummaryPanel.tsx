import { GaugeIcon, WarningIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { Card } from "../Card/Card";
import { EmptyState } from "../EmptyState/EmptyState";
import { SectionPanel } from "../SectionPanel/SectionPanel";
import { SeriesChart } from "../SeriesChart/SeriesChart";
import { Spinner } from "../Spinner/Spinner";
import { StackedBar } from "../StackedBar/StackedBar";
import {
  type StackedSeries,
  StackedSeriesChart,
} from "../StackedSeriesChart/StackedSeriesChart";
import { StatCell, StatsStrip } from "../StatsStrip/StatsStrip";
import { Breakdown } from "./UsageBreakdown";
import styles from "./UsageSummary.module.css";

export interface UsageModelRowData {
  /** Unique per row: the same model can show once per runner. */
  id: string;
  model: string;
  cost: string;
  share: string;
  tokens: string;
  progress: number;
  priced: boolean;
}

/** One speed tier: standard, fast or ultrafast. */
export interface UsageSpeedRowData {
  id: string;
  label: string;
  /** "+$4.20 premium"; null at standard speed. */
  premium: string | null;
  cost: string;
  share: string;
  tokens: string;
  progress: number;
}

export interface UsageRunnerRowData {
  id: string;
  label: string;
  /** "12 sessions". */
  sessions: string;
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
    /** Stacked by runner; null draws the single series. */
    series: StackedSeries[] | null;
  };
  totals: { label: string; value: string }[];
  parts: {
    caption: string;
    segments: {
      label: string;
      value: number;
      display: string;
      detail: string;
      other?: boolean;
    }[];
  };
  runners: UsageRunnerRowData[];
  models: UsageModelRowData[];
  hasUnpriced: boolean;
  /** Per speed tier; empty when everything ran at standard speed. */
  speeds?: UsageSpeedRowData[];
}

export interface UsageSummaryPanelProps {
  /** Only ever the range asked for; null while it loads. */
  summary: UsageSummaryData | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  retrying: boolean;
  /** Opens a model's detail; rows are plain without it. */
  onModelSelect?: (id: string) => void;
}

/** Cost or tokens over a range: headline, chart, totals, parts, per runner and per model. */
export function UsageSummaryPanel({
  summary,
  loading,
  error,
  onRetry,
  retrying,
  onModelSelect,
}: UsageSummaryPanelProps) {
  if (!summary) {
    if (loading) {
      return (
        <div className={styles.loading}>
          <Spinner />
          <span>Reading agent sessions…</span>
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
        body="Agent sessions on the computer show up here."
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
        {summary.chart.series ? (
          <StackedSeriesChart
            caption={summary.chart.caption}
            formatValue={summary.chart.formatValue}
            kind={summary.chart.kind}
            labels={summary.chart.labels}
            series={summary.chart.series}
          />
        ) : (
          <SeriesChart
            caption={summary.chart.caption}
            formatValue={summary.chart.formatValue}
            kind={summary.chart.kind}
            labels={summary.chart.labels}
            values={summary.chart.values}
          />
        )}
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

      {summary.runners.length > 1 && (
        <SectionPanel plain title="By runner">
          <Breakdown
            heading="Runner"
            rows={summary.runners.map((r) => ({
              ...r,
              name: r.label,
              detail: r.sessions,
            }))}
            unpricedTitle="No price for its models"
          />
        </SectionPanel>
      )}

      {summary.speeds && summary.speeds.length > 0 && (
        <SectionPanel plain title="By speed">
          <Breakdown
            heading="Speed"
            rows={summary.speeds.map((sp) => ({
              ...sp,
              name: sp.label,
              detail: sp.premium ?? undefined,
              priced: true,
            }))}
            unpricedTitle=""
          />
        </SectionPanel>
      )}

      <SectionPanel plain title="By model">
        <Breakdown
          heading="Model"
          onSelect={onModelSelect}
          note={
            summary.hasUnpriced
              ? "— marks models the price list doesn’t cover; their tokens still count."
              : undefined
          }
          rows={summary.models.map((m) => ({ ...m, name: m.model }))}
          unpricedTitle="Not in the price list"
        />
      </SectionPanel>
    </div>
  );
}
