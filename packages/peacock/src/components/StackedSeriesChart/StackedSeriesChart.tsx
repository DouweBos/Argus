import type { SeriesChartKind } from "../SeriesChart/SeriesChart";
import {
  CHART_HEIGHT,
  CHART_WIDTH,
  PAD,
  PLOT_WIDTH,
  bandCenter,
  barWidth,
  domainFor,
  formatValue as compactValue,
  labelStride,
  linePath,
  valueLabelY,
  yFor,
} from "../SeriesChart/scale";
import styles from "./StackedSeriesChart.module.css";
import {
  layerAreaPath,
  layerPoints,
  segmentPath,
  stackLayers,
  stackTotals,
} from "./stack";

export interface StackedSeries {
  label: string;
  /** One per label. */
  values: number[];
  /** A catch-all ("Other"), drawn in the neutral colour rather than a hue. */
  other?: boolean;
}

export interface StackedSeriesChartProps {
  labels: string[];
  /** Bottom to top; up to four hued series plus catch-alls. */
  series: StackedSeries[];
  kind?: SeriesChartKind;
  caption?: string;
  className?: string;
  formatValue?: (value: number) => string;
}

const HUES = [styles.s1, styles.s2, styles.s3, styles.s4];

/** Hue per series in order; past the fourth a series has no colour to take. */
function colourSeries(series: StackedSeries[]) {
  let hue = 0;

  return series.flatMap((s) => {
    if (s.other) {
      return [{ ...s, tone: styles.other }];
    }
    const tone = HUES[hue++];

    return tone ? [{ ...s, tone }] : [];
  });
}

/**
 * A whole over time split into parts: stacked bars, or stacked areas for long
 * ranges, from the categorical chart tokens with a labelled legend.
 */
export function StackedSeriesChart({
  labels,
  series,
  kind = "bar",
  caption,
  className,
  formatValue = compactValue,
}: StackedSeriesChartProps) {
  const count = labels.length;
  const shown = colourSeries(series);
  if (count === 0 || shown.length === 0) {
    return null;
  }
  const layers = stackLayers(
    shown.map((s) => s.values),
    count,
  );
  const totals = stackTotals(layers, count);
  const domain = domainFor(totals);
  const stride = labelStride(count);
  const direct = count <= 8;
  const width = barWidth(count);
  const summary = `${caption ?? "Series"}: ${labels
    .map((n, i) => `${n} ${formatValue(totals[i])}`)
    .join(", ")}`;
  const topLayer = (i: number) => {
    let top = -1;
    layers.forEach((l, k) => {
      if (l.upper[i] > l.lower[i]) {
        top = k;
      }
    });

    return top;
  };

  return (
    <figure className={[styles.figure, className].filter(Boolean).join(" ")}>
      {caption && <figcaption className={styles.caption}>{caption}</figcaption>}
      <svg
        className={styles.chart}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={summary}
      >
        {domain.ticks.map((tick) => (
          <g key={tick}>
            <line
              className={styles.grid}
              x1={PAD.left}
              x2={PAD.left + PLOT_WIDTH}
              y1={yFor(tick, domain)}
              y2={yFor(tick, domain)}
            />
            <text
              className={styles.axisLabel}
              x={PAD.left - 8}
              y={yFor(tick, domain)}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {formatValue(tick)}
            </text>
          </g>
        ))}

        {kind === "line" &&
          layers.map((layer, k) => (
            <g className={shown[k].tone} key={shown[k].label}>
              <path className={styles.area} d={layerAreaPath(layer, domain)} />
              <path
                className={styles.line}
                d={linePath(layerPoints(layer.upper, domain))}
              />
            </g>
          ))}

        {labels.map((name, i) => {
          const center = bandCenter(i, count);
          const top = topLayer(i);
          const tip = [
            `${name}: ${formatValue(totals[i])}`,
            ...shown.map((s, k) =>
              layers[k].upper[i] > layers[k].lower[i]
                ? `${s.label} ${formatValue(layers[k].upper[i] - layers[k].lower[i])}`
                : null,
            ),
          ].filter(Boolean);

          return (
            <g className={styles.mark} key={`${name}-${i}`}>
              <title>{tip.join("\n")}</title>
              {kind === "bar" &&
                layers.map((layer, k) =>
                  layer.upper[i] > layer.lower[i] ? (
                    <path
                      className={`${styles.bar} ${shown[k].tone}`}
                      d={segmentPath(
                        center - width / 2,
                        width,
                        layer.lower[i],
                        layer.upper[i],
                        domain,
                        k === top,
                      )}
                      key={shown[k].label}
                    />
                  ) : null,
                )}
              <rect
                className={styles.hit}
                x={center - PLOT_WIDTH / count / 2}
                y={PAD.top}
                width={PLOT_WIDTH / count}
                height={CHART_HEIGHT - PAD.top - PAD.bottom}
              />
              {direct && (
                <text
                  className={styles.valueLabel}
                  x={center}
                  y={valueLabelY(totals[i], domain)}
                  textAnchor="middle"
                >
                  {formatValue(totals[i])}
                </text>
              )}
            </g>
          );
        })}

        <line
          className={styles.axis}
          x1={PAD.left}
          x2={PAD.left + PLOT_WIDTH}
          y1={yFor(0, domain)}
          y2={yFor(0, domain)}
        />

        {labels.map((name, i) =>
          i % stride === 0 || i === count - 1 ? (
            <text
              className={styles.axisLabel}
              key={`${name}-${i}`}
              x={bandCenter(i, count)}
              y={CHART_HEIGHT - 8}
              textAnchor="middle"
            >
              {name}
            </text>
          ) : null,
        )}
      </svg>
      <ul className={styles.legend}>
        {shown.map((s) => (
          <li className={styles.item} key={s.label}>
            <span className={`${styles.swatch} ${s.tone}`} />
            <span>{s.label}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
