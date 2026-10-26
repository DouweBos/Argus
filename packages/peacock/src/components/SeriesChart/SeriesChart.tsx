import styles from "./SeriesChart.module.css";
import {
  CHART_HEIGHT,
  CHART_WIDTH,
  PAD,
  PLOT_WIDTH,
  areaPath,
  bandCenter,
  barPath,
  barWidth,
  domainFor,
  formatValue as compactValue,
  labelStride,
  linePath,
  linePoints,
  valueLabelY,
  yFor,
} from "./scale";

export type SeriesChartKind = "bar" | "line";

export interface SeriesChartProps {
  /** One category per value; lengths must match. */
  labels: string[];
  values: number[];
  kind?: SeriesChartKind;
  /** Names the measure. A single series needs no legend — this is the label. */
  caption?: string;
  className?: string;
  /** Axis, label and tooltip text for a value; compact numbers by default. */
  formatValue?: (value: number) => string;
}

/**
 * One series, bar or line, drawn from chart tokens only. Zero-anchored,
 * recessive grid, per-mark hover, and direct value labels while the series is
 * short enough for them to stay legible.
 */
export function SeriesChart({
  labels,
  values,
  kind = "bar",
  caption,
  className,
  formatValue = compactValue,
}: SeriesChartProps) {
  const count = Math.min(labels.length, values.length);
  if (count === 0) {
    return null;
  }
  const data = values.slice(0, count);
  const names = labels.slice(0, count);
  const domain = domainFor(data);
  const stride = labelStride(count);
  const direct = count <= 8;
  const points = linePoints(data, domain);
  const width = barWidth(count);
  const summary = `${caption ?? "Series"}: ${names
    .map((n, i) => `${n} ${formatValue(data[i])}`)
    .join(", ")}`;

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
        <line
          className={styles.axis}
          x1={PAD.left}
          x2={PAD.left + PLOT_WIDTH}
          y1={yFor(0, domain)}
          y2={yFor(0, domain)}
        />

        {kind === "line" && (
          <>
            <path className={styles.area} d={areaPath(points, domain)} />
            <path className={styles.line} d={linePath(points)} />
          </>
        )}

        {data.map((value, i) => {
          const center = bandCenter(i, count);
          const tip = yFor(value, domain);

          return (
            <g className={styles.mark} key={`${names[i]}-${i}`}>
              <title>{`${names[i]}: ${formatValue(value)}`}</title>
              {kind === "bar" ? (
                <path
                  className={styles.bar}
                  d={barPath(center - width / 2, width, value, domain)}
                />
              ) : (
                count <= 12 && (
                  <circle className={styles.dot} cx={center} cy={tip} r={4} />
                )
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
                  y={valueLabelY(value, domain)}
                  textAnchor="middle"
                >
                  {formatValue(value)}
                </text>
              )}
            </g>
          );
        })}

        {names.map((name, i) =>
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
    </figure>
  );
}
