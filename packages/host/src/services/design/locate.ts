/**
 * Finds where a rendered component sits on a screenshot: grayscale,
 * zero-mean normalized cross-correlation, searched coarse-to-fine over an
 * image pyramid.
 */

import type { PNG } from "pngjs";

export interface Gray {
  width: number;
  height: number;
  data: Float32Array;
}

export interface Located {
  x: number;
  y: number;
  /** ZNCC at the hit, clamped to 0–1. */
  confidence: number;
}

/** The template's short side stays at least this long at the coarsest level. */
const MIN_COARSE_SIDE = 16;
/** Past this many multiply-adds the coarse search goes one level coarser, down to a short side of this. */
const COARSE_BUDGET = 20_000_000;
const MIN_BUDGET_SIDE = 8;
const COARSE_PEAKS = 5;
const REFINE_RADIUS = 2;

/** Luma, composited over white the way pixelmatch blends transparency. */
export function toGray(png: PNG): Gray {
  const { width, height, data } = png;
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const o = i * 4;
    const a = data[o + 3] / 255;
    const luma = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    out[i] = luma * a + 255 * (1 - a);
  }

  return { width, height, data: out };
}

/** Area-average resample to an arbitrary size. */
export function resample(src: Gray, width: number, height: number): Gray {
  const out = new Float32Array(width * height);
  const rx = src.width / width;
  const ry = src.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.min(src.height - 1, Math.floor(y * ry));
    const y1 = Math.min(src.height, Math.max(y0 + 1, Math.floor((y + 1) * ry)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.min(src.width - 1, Math.floor(x * rx));
      const x1 = Math.min(
        src.width,
        Math.max(x0 + 1, Math.floor((x + 1) * rx)),
      );
      let sum = 0;
      for (let sy = y0; sy < y1; sy++) {
        const row = sy * src.width;
        for (let sx = x0; sx < x1; sx++) {
          sum += src.data[row + sx];
        }
      }
      out[y * width + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }

  return { width, height, data: out };
}

function half(img: Gray): Gray {
  return resample(
    img,
    Math.max(1, img.width >> 1),
    Math.max(1, img.height >> 1),
  );
}

/** Summed-area tables of values and squares, for O(1) window statistics. */
interface Integral {
  width: number;
  sum: Float64Array;
  sq: Float64Array;
}

function integral(img: Gray): Integral {
  const w = img.width + 1;
  const sum = new Float64Array(w * (img.height + 1));
  const sq = new Float64Array(w * (img.height + 1));
  for (let y = 0; y < img.height; y++) {
    let rowSum = 0;
    let rowSq = 0;
    for (let x = 0; x < img.width; x++) {
      const v = img.data[y * img.width + x];
      rowSum += v;
      rowSq += v * v;
      sum[(y + 1) * w + x + 1] = sum[y * w + x + 1] + rowSum;
      sq[(y + 1) * w + x + 1] = sq[y * w + x + 1] + rowSq;
    }
  }

  return { width: w, sum, sq };
}

function boxSum(
  t: Float64Array,
  w: number,
  x: number,
  y: number,
  tw: number,
  th: number,
): number {
  return (
    t[(y + th) * w + x + tw] -
    t[y * w + x + tw] -
    t[(y + th) * w + x] +
    t[y * w + x]
  );
}

/** A template ready to correlate: zero-mean values and their norm. */
interface Prepared {
  img: Gray;
  zero: Float32Array;
  norm: number;
}

function prepare(tpl: Gray): Prepared {
  const n = tpl.data.length;
  let mean = 0;
  for (let i = 0; i < n; i++) {
    mean += tpl.data[i];
  }
  mean /= n;
  const zero = new Float32Array(n);
  let norm = 0;
  for (let i = 0; i < n; i++) {
    zero[i] = tpl.data[i] - mean;
    norm += zero[i] * zero[i];
  }

  return { img: tpl, zero, norm: Math.sqrt(norm) };
}

class Level {
  readonly table: Integral;

  constructor(readonly img: Gray) {
    this.table = integral(img);
  }

  score(t: Prepared, x: number, y: number): number {
    const { width: tw, height: th } = t.img;
    if (x < 0 || y < 0 || x + tw > this.img.width || y + th > this.img.height) {
      return -1;
    }
    const n = tw * th;
    const s = boxSum(this.table.sum, this.table.width, x, y, tw, th);
    const s2 = boxSum(this.table.sq, this.table.width, x, y, tw, th);
    const variance = s2 - (s * s) / n;
    if (t.norm < 1e-6 || variance < 1e-6) {
      return 0;
    }
    let dot = 0;
    const { data, width } = this.img;
    for (let ty = 0; ty < th; ty++) {
      const row = (y + ty) * width + x;
      const trow = ty * tw;
      for (let tx = 0; tx < tw; tx++) {
        dot += t.zero[trow + tx] * data[row + tx];
      }
    }

    return dot / (t.norm * Math.sqrt(variance));
  }
}

/** The screenshot's pyramid, built once and reused for every candidate scale. */
export class Haystack {
  private readonly levels: Level[];

  constructor(screenshot: Gray) {
    this.levels = [new Level(screenshot)];
  }

  get width(): number {
    return this.levels[0].img.width;
  }

  get height(): number {
    return this.levels[0].img.height;
  }

  private level(k: number): Level {
    while (this.levels.length <= k) {
      this.levels.push(
        new Level(half(this.levels[this.levels.length - 1].img)),
      );
    }

    return this.levels[k];
  }

  /** Correlation of the template placed at (x, y), full resolution. */
  scoreAt(template: Gray, x: number, y: number): number {
    return Math.max(0, this.level(0).score(prepare(template), x, y));
  }

  /** The best placement of a template no larger than the screenshot. */
  locate(template: Gray): Located | null {
    if (template.width > this.width || template.height > this.height) {
      return null;
    }
    const tpls = [template];
    let k = 0;
    const cost = (l: number) => {
      const t = tpls[l];
      const w = this.width >> l;
      const h = this.height >> l;

      return (
        Math.max(0, w - t.width + 1) *
        Math.max(0, h - t.height + 1) *
        t.width *
        t.height
      );
    };
    for (;;) {
      const next = Math.min(tpls[k].width, tpls[k].height) >> 1;
      if (
        next < MIN_BUDGET_SIDE ||
        (next < MIN_COARSE_SIDE && cost(k) <= COARSE_BUDGET)
      ) {
        break;
      }
      tpls.push(half(tpls[k]));
      k++;
    }
    const prepared = tpls.map(prepare);
    const coarse = this.level(k);
    const peaks = topPeaks(coarse, prepared[k]);
    let best: Located | null = null;
    for (const peak of peaks) {
      let { x, y } = peak;
      let score = peak.score;
      for (let l = k - 1; l >= 0; l--) {
        const hit = refine(this.level(l), prepared[l], x * 2, y * 2);
        ({ x, y, score } = hit);
      }
      if (!best || score > best.confidence) {
        best = { x, y, confidence: score };
      }
    }

    return (
      best && { ...best, confidence: Math.max(0, Math.min(1, best.confidence)) }
    );
  }
}

function topPeaks(
  level: Level,
  t: Prepared,
): { x: number; y: number; score: number }[] {
  const cols = level.img.width - t.img.width + 1;
  const rows = level.img.height - t.img.height + 1;
  const scores = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      scores[y * cols + x] = level.score(t, x, y);
    }
  }
  const peaks: { x: number; y: number; score: number }[] = [];
  for (let p = 0; p < COARSE_PEAKS; p++) {
    let at = -1;
    for (let i = 0; i < scores.length; i++) {
      if (at < 0 || scores[i] > scores[at]) {
        at = i;
      }
    }
    if (at < 0 || scores[at] === -Infinity) {
      break;
    }
    const x = at % cols;
    const y = Math.floor(at / cols);
    peaks.push({ x, y, score: scores[at] });
    for (let sy = Math.max(0, y - 2); sy <= Math.min(rows - 1, y + 2); sy++) {
      for (let sx = Math.max(0, x - 2); sx <= Math.min(cols - 1, x + 2); sx++) {
        scores[sy * cols + sx] = -Infinity;
      }
    }
  }

  return peaks;
}

function refine(
  level: Level,
  t: Prepared,
  cx: number,
  cy: number,
): { x: number; y: number; score: number } {
  let best = { x: cx, y: cy, score: -Infinity };
  for (let dy = -REFINE_RADIUS; dy <= REFINE_RADIUS; dy++) {
    for (let dx = -REFINE_RADIUS; dx <= REFINE_RADIUS; dx++) {
      const score = level.score(t, cx + dx, cy + dy);
      if (score > best.score) {
        best = { x: cx + dx, y: cy + dy, score };
      }
    }
  }

  return best;
}
