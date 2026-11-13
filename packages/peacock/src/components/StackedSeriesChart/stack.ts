/** Pure geometry for StackedSeriesChart — no React, so it can be unit-tested. */

import {
  type Domain,
  type Point,
  bandCenter,
  linePath,
  yFor,
} from "../SeriesChart/scale";

export interface StackLayer {
  /** Per band, where the layer starts and ends. */
  lower: number[];
  upper: number[];
}

/** Cumulative layers, first series at the bottom; negatives count as zero. */
export function stackLayers(series: number[][], count: number): StackLayer[] {
  const running = new Array<number>(count).fill(0);

  return series.map((values) => {
    const lower = [...running];
    for (let i = 0; i < count; i++) {
      running[i] += Math.max(0, values[i] ?? 0);
    }

    return { lower, upper: [...running] };
  });
}

/** Per-band totals of the stack, for the domain and the direct labels. */
export function stackTotals(layers: StackLayer[], count: number): number[] {
  const top = layers[layers.length - 1];

  return top ? top.upper.slice(0, count) : new Array<number>(count).fill(0);
}

/** One bar segment; only the stack's top segment rounds its data end. */
export function segmentPath(
  x: number,
  width: number,
  lower: number,
  upper: number,
  domain: Domain,
  roundTop: boolean,
): string {
  const base = yFor(lower, domain);
  const top = yFor(upper, domain);
  const r = roundTop ? Math.min(4, width / 2, base - top) : 0;

  return [
    `M${x} ${base}`,
    `L${x} ${top + r}`,
    `Q${x} ${top} ${x + r} ${top}`,
    `L${x + width - r} ${top}`,
    `Q${x + width} ${top} ${x + width} ${top + r}`,
    `L${x + width} ${base}`,
    "Z",
  ].join(" ");
}

export function layerPoints(values: number[], domain: Domain): Point[] {
  return values.map((v, i) => ({
    x: bandCenter(i, values.length),
    y: yFor(v, domain),
  }));
}

/** The band between a layer's lower and upper edge. */
export function layerAreaPath(layer: StackLayer, domain: Domain): string {
  const upper = layerPoints(layer.upper, domain);
  const lower = layerPoints(layer.lower, domain).reverse();
  if (upper.length === 0) {
    return "";
  }

  return `${linePath(upper)} ${lower.map((p) => `L${p.x} ${p.y}`).join(" ")} Z`;
}
