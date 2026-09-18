/** Pure geometry for SeriesChart — no React, so it can be unit-tested. */

export const CHART_WIDTH = 640;
export const CHART_HEIGHT = 200;
export const PAD = { top: 14, right: 10, bottom: 24, left: 44 };

export const PLOT_WIDTH = CHART_WIDTH - PAD.left - PAD.right;
export const PLOT_HEIGHT = CHART_HEIGHT - PAD.top - PAD.bottom;

/** Round a magnitude up to the next 1 / 2 / 2.5 / 5 × 10ⁿ step. */
export function niceCeil(value: number): number {
  if (value <= 0) {
    return 0;
  }
  const exp = Math.floor(Math.log10(value));
  const pow = 10 ** exp;
  const frac = value / pow;
  const step = [1, 2, 2.5, 5, 10].find((s) => frac <= s + 1e-9) ?? 10;

  return step * pow;
}

export interface Domain {
  max: number;
  min: number;
  /** Tick values, low to high, always including zero. */
  ticks: number[];
}

/** Domain anchored at zero — bar length is only honest from a zero baseline. */
export function domainFor(values: number[]): Domain {
  const max = niceCeil(Math.max(0, ...values)) || 1;
  const min = -niceCeil(Math.max(0, ...values.map((v) => -v)));
  const ticks = min < 0 ? [min, 0, max] : [0, max / 2, max];

  return { max, min, ticks };
}

export function yFor(value: number, domain: Domain): number {
  const span = domain.max - domain.min || 1;

  return PAD.top + ((domain.max - value) / span) * PLOT_HEIGHT;
}

/** Centre of the nth of `count` evenly spaced bands. */
export function bandCenter(index: number, count: number): number {
  const band = PLOT_WIDTH / Math.max(count, 1);

  return PAD.left + band * (index + 0.5);
}

/** Bar width: thin marks, a 2px surface gap, never wider than 32px. */
export function barWidth(count: number): number {
  const band = PLOT_WIDTH / Math.max(count, 1);

  return Math.max(2, Math.min(32, band - 2));
}

/** A bar with its data-end rounded and its base square on the baseline. */
export function barPath(
  x: number,
  width: number,
  value: number,
  domain: Domain,
): string {
  const base = yFor(0, domain);
  const tip = yFor(value, domain);
  const height = Math.abs(tip - base);
  const r = Math.min(4, width / 2, height);
  const dir = value < 0 ? -1 : 1;
  const top = base - height * dir;

  return [
    `M${x} ${base}`,
    `L${x} ${top + r * dir}`,
    `Q${x} ${top} ${x + r} ${top}`,
    `L${x + width - r} ${top}`,
    `Q${x + width} ${top} ${x + width} ${top + r * dir}`,
    `L${x + width} ${base}`,
    "Z",
  ].join(" ");
}

export interface Point {
  x: number;
  y: number;
}

export function linePoints(values: number[], domain: Domain): Point[] {
  return values.map((v, i) => ({
    x: bandCenter(i, values.length),
    y: yFor(v, domain),
  }));
}

export function linePath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
}

export function areaPath(points: Point[], domain: Domain): string {
  if (points.length === 0) {
    return "";
  }
  const base = yFor(0, domain);
  const first = points[0];
  const last = points[points.length - 1];

  return `${linePath(points)} L${last.x} ${base} L${first.x} ${base} Z`;
}

/** Compact value text — 1.2k / 3.4M — so axis labels never collide. */
export function formatValue(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${trim(value / 1_000_000)}M`;
  }
  if (abs >= 1000) {
    return `${trim(value / 1000)}k`;
  }

  return trim(value);
}

function trim(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * Show every nth x label so they never overlap, and always the last one — a
 * dense series gets a readable spine rather than a smear.
 */
export function labelStride(count: number): number {
  return Math.max(1, Math.ceil(count / 8));
}

/**
 * Where a direct value label sits. Above the data end for a positive value,
 * above the zero baseline for a negative one — below the mark would land in
 * the x-label row whenever the series reaches the floor.
 */
export function valueLabelY(value: number, domain: Domain): number {
  const y = value < 0 ? yFor(0, domain) - 6 : yFor(value, domain) - 6;

  return Math.max(y, PAD.top + 8);
}
