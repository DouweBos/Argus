import type { SummaryMetric } from "./summaryMetric";
import type { UsageSummaryState } from "./useUsageSummary";
import type { ClaudeUsageSummary } from "../../lib/types";
import {
  Button,
  Card,
  EmptyState,
  Icons,
  SectionPanel,
  SeriesChart,
  Spinner,
  StackedBar,
  StatCell,
  StatsStrip,
} from "@argus/peacock";
import {
  bucketLabel,
  formatShare,
  formatTokens,
  formatUsd,
} from "../../lib/usageFormat";
import { UsageBreakdown } from "./UsageBreakdown";
import styles from "./UsageSummary.module.css";
import { METRICS } from "./summaryMetric";

interface SummaryViewProps {
  metric: SummaryMetric;
  summary: UsageSummaryState;
}

/** `/usage/cost` and `/usage/tokens` — one layout keyed on either measure. */
export function SummaryView({ metric, summary }: SummaryViewProps) {
  const { data, error, loading, refresh, refreshing } = summary;

  if (!data) {
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
          <Button disabled={refreshing} onClick={refresh} size="sm">
            Try again
          </Button>
        }
        body={error ?? undefined}
        icon={<Icons.WarningIcon size={18} />}
        title="Couldn't read usage"
      />
    );
  }

  if (data.sessions === 0) {
    return (
      <EmptyState
        body="No Claude Code sessions on this machine in this period."
        icon={<Icons.GaugeIcon size={18} />}
        title="No usage yet"
      />
    );
  }

  return <SummaryBody data={data} error={error} metric={metric} />;
}

function SummaryBody({
  data,
  error,
  metric,
}: {
  data: ClaudeUsageSummary;
  error: string | null;
  metric: SummaryMetric;
}) {
  const view = METRICS[metric];
  const parts = view.parts(data);
  const total = metric === "cost" ? data.cost.total : data.tokens.processed;
  const values = data.series.map(view.point);

  return (
    <div className={styles.summary}>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.headline}>
        <span className={styles.total}>{view.headline(data)}</span>
        <span className={styles.caption}>
          {data.sessions.toLocaleString("en-US")}{" "}
          {data.sessions === 1 ? "session" : "sessions"}
          {metric === "cost" ? " · API estimate" : " · processed tokens"}
        </span>
      </div>
      {metric === "cost" && data.prices_fetched_at === null && (
        <p className={styles.note}>
          Costs appear once the price list downloads.
        </p>
      )}

      <Card>
        <SeriesChart
          caption={view.chartTitle(data.bucket)}
          formatValue={view.axis}
          kind={values.length > 31 ? "line" : "bar"}
          labels={data.series.map((p) => bucketLabel(p.start, data.bucket))}
          values={values}
        />
      </Card>

      <SectionPanel plain title="Totals">
        <StatsStrip>
          <StatCell
            label="Processed tokens"
            value={formatTokens(data.tokens.processed)}
          />
          <StatCell
            label="Cached input"
            value={formatTokens(data.tokens.cache_read)}
          />
          <StatCell
            label="Uncached input"
            value={formatTokens(data.tokens.input)}
          />
          <StatCell label="Output" value={formatTokens(data.tokens.output)} />
          <StatCell
            label="Cache savings"
            value={formatUsd(data.cache_savings_usd)}
          />
        </StatsStrip>
      </SectionPanel>

      <Card>
        <StackedBar
          caption={view.partsTitle}
          segments={parts.map((p) => ({
            ...p,
            display: view.format(p.value),
            detail: formatShare(p.value, total),
          }))}
        />
      </Card>

      <SectionPanel plain title="By model">
        <UsageBreakdown metric={view} models={data.models} total={total} />
      </SectionPanel>
    </div>
  );
}
