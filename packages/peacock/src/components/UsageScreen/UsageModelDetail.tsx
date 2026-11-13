import { ArrowBackIcon, TagIcon, WarningIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { Card } from "../Card/Card";
import { EmptyState } from "../EmptyState/EmptyState";
import { SectionPanel } from "../SectionPanel/SectionPanel";
import { SeriesChart } from "../SeriesChart/SeriesChart";
import { Spinner } from "../Spinner/Spinner";
import { StatCell, StatsStrip } from "../StatsStrip/StatsStrip";
import styles from "./UsageSummary.module.css";

/** One model of a range, from `usageModelDetailView` in `@argus/client-core`. */
export interface UsageModelDetailData {
  title: string;
  /** The runner it ran through. */
  runner: string;
  headline: string;
  caption: string;
  /** No price: offer to set one. */
  unpriced: boolean;
  chart: {
    caption: string;
    labels: string[];
    values: number[];
    kind: "bar" | "line";
    formatValue: (value: number) => string;
  } | null;
  stats: { label: string; value: string }[];
  /** Model ids counted as this one through a price mapping. */
  mappedFrom: string[];
}

export interface UsageModelDetailProps {
  /** Null while the range loads, or when the range has no such model. */
  detail: UsageModelDetailData | null;
  loading: boolean;
  onBack: () => void;
  /** Opens the price editor with this model in it; hidden without control. */
  onSetPrice?: () => void;
}

/** A model's own trend, cache hit rate, rate per million tokens and price source. */
export function UsageModelDetail({
  detail,
  loading,
  onBack,
  onSetPrice,
}: UsageModelDetailProps) {
  const back = (
    <Button
      leading={<ArrowBackIcon size={12} />}
      onClick={onBack}
      size="sm"
      variant="ghost"
    >
      All models
    </Button>
  );

  if (!detail) {
    return (
      <div className={styles.summary}>
        <div>{back}</div>
        {loading ? (
          <div className={styles.loading}>
            <Spinner />
          </div>
        ) : (
          <EmptyState
            body="Nothing ran on this model in the range."
            icon={<WarningIcon size={18} />}
            title="No usage for this model"
          />
        )}
      </div>
    );
  }

  return (
    <div className={styles.summary}>
      <div>{back}</div>
      <div className={styles.headline}>
        <span className={styles.detailTitle}>
          {detail.title}
          <span className={styles.detail}> · {detail.runner}</span>
        </span>
        <span className={styles.total}>{detail.headline}</span>
        <span className={styles.caption}>{detail.caption}</span>
      </div>

      {detail.unpriced && (
        <div className={styles.callout}>
          <span>
            Argus has no price for this model, so its cost isn’t counted.
          </span>
          {onSetPrice && (
            <Button
              leading={<TagIcon size={12} />}
              onClick={onSetPrice}
              size="sm"
              variant="secondary"
            >
              Set price
            </Button>
          )}
        </div>
      )}

      {detail.chart && (
        <Card>
          <SeriesChart
            caption={detail.chart.caption}
            formatValue={detail.chart.formatValue}
            kind={detail.chart.kind}
            labels={detail.chart.labels}
            values={detail.chart.values}
          />
        </Card>
      )}

      <StatsStrip>
        {detail.stats.map((s) => (
          <StatCell key={s.label} label={s.label} value={s.value} />
        ))}
      </StatsStrip>

      {detail.mappedFrom.length > 0 && (
        <SectionPanel plain title="Counted as this model">
          <ul className={styles.mapped}>
            {detail.mappedFrom.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </SectionPanel>
      )}
    </div>
  );
}
