/**
 * Congestion controller for the remote device stream.
 *
 * Remote viewers (phone over cellular/Tailscale) share one bitrate-capped
 * encode. This decides its target from what each viewer's socket reports:
 * AIMD on the bitrate (cut hard on congestion, probe up slowly once every
 * viewer is clear), and a resolution/fps level derived from the bitrate with
 * hysteresis so a link hovering at a boundary doesn't flap the encoder.
 *
 * Pure: time is passed in, so tests drive it with fake clocks.
 */

export type StreamLevelName = "full" | "high" | "low" | "medium";

export interface StreamLevel {
  name: StreamLevelName;
  /** Longest encoded side in pixels. */
  maxDim: number;
  fps: number;
  /** Lowest bitrate (bits/s) this level is still worth encoding at. */
  floor: number;
}

/** Best first. A level holds while the bitrate stays at or above its floor. */
export const STREAM_LEVELS: readonly StreamLevel[] = [
  { name: "full", maxDim: 1920, fps: 30, floor: 3_000_000 },
  { name: "high", maxDim: 1280, fps: 30, floor: 1_500_000 },
  { name: "medium", maxDim: 960, fps: 30, floor: 700_000 },
  { name: "low", maxDim: 640, fps: 15, floor: 0 },
];

export interface StreamTarget {
  bitrate: number;
  level: StreamLevel;
}

/** One viewer's socket counters, sampled periodically. */
export interface ViewerSample {
  /** Bytes queued on the socket right now. */
  buffered: number;
  /** Media bytes handed to the socket so far (cumulative). */
  sentBytes: number;
  /** Frames shed under backpressure so far (cumulative). */
  dropped: number;
}

export interface BitrateTuning {
  min: number;
  max: number;
  start: number;
  /** Multiplicative decrease on congestion. */
  decrease: number;
  /** A cut never lands above this share of the measured throughput. */
  throughputMargin: number;
  /** A cut leaves room to empty the queue within this long. */
  drainTargetMs: number;
  /** Additive increase per clean window once out of slow start, as a share of
   *  the current bitrate, bounded by the step limits below. */
  increaseShare: number;
  minIncreaseStep: number;
  maxIncreaseStep: number;
  /** Multiplicative increase per clean window until the first congestion. */
  slowStartFactor: number;
  slowStartCleanMs: number;
  cleanBeforeIncreaseMs: number;
  /** Minimum gap between cuts, so one burst isn't punished twice. */
  holdAfterDecreaseMs: number;
  /** After a cut, only a queue that keeps growing cuts again this soon. */
  drainGraceMs: number;
  /** No probing for this long after a cut. */
  probeAfterDecreaseMs: number;
  /** Minimum time on a level before stepping up a level; doubles (up to the
   *  max) each time a step up is undone soon after. */
  levelUpDwellMs: number;
  maxLevelUpDwellMs: number;
  /** Stepping up needs the next level's floor times this. */
  levelUpMargin: number;
  /** Queue size that's congested regardless of drain rate. */
  highWaterBytes: number;
  /** Queue size below which a viewer counts as clear. */
  lowWaterBytes: number;
  /** A queue that takes longer than this to drain is congested. */
  maxDrainMs: number;
}

export const DEFAULT_TUNING: BitrateTuning = {
  min: 250_000,
  max: 8_000_000,
  start: 2_500_000,
  decrease: 0.6,
  throughputMargin: 0.85,
  drainTargetMs: 2_000,
  increaseShare: 0.1,
  minIncreaseStep: 50_000,
  maxIncreaseStep: 400_000,
  slowStartFactor: 1.5,
  slowStartCleanMs: 1_000,
  cleanBeforeIncreaseMs: 2_000,
  holdAfterDecreaseMs: 1_000,
  drainGraceMs: 4_000,
  probeAfterDecreaseMs: 5_000,
  levelUpDwellMs: 5_000,
  maxLevelUpDwellMs: 60_000,
  levelUpMargin: 1.3,
  highWaterBytes: 512 * 1024,
  lowWaterBytes: 64 * 1024,
  maxDrainMs: 500,
};

type Verdict = "clear" | "congested" | "neutral";

interface Assessment {
  verdict: Verdict;
  /** Bits/s that actually left the queue over the interval; null if unknown. */
  throughput: number | null;
  /** Frames were dropped or the queue grew since the last sample. */
  worsening: boolean;
  buffered: number;
}

/** Classify one viewer from two consecutive samples. Exported for tests. */
export function assessViewer(
  prev: ViewerSample,
  cur: ViewerSample,
  elapsedMs: number,
  tuning: BitrateTuning = DEFAULT_TUNING,
): Assessment {
  const drops = cur.dropped - prev.dropped;
  const worsening = drops > 0 || cur.buffered > prev.buffered;
  const drained =
    cur.sentBytes - prev.sentBytes - (cur.buffered - prev.buffered);
  const throughput =
    elapsedMs > 0 && drained > 0 ? (drained * 8 * 1000) / elapsedMs : null;
  const base = { throughput, worsening, buffered: cur.buffered };
  let drainMs = 0;
  if (cur.buffered > 0) {
    drainMs = throughput ? (cur.buffered * 8 * 1000) / throughput : Infinity;
  }

  if (
    drops > 0 ||
    cur.buffered > tuning.highWaterBytes ||
    (cur.buffered > tuning.lowWaterBytes && drainMs > tuning.maxDrainMs)
  ) {
    return { ...base, verdict: "congested" };
  }
  if (cur.buffered <= tuning.lowWaterBytes) {
    return { ...base, verdict: "clear" };
  }

  return { ...base, verdict: "neutral" };
}

/** The best level a bitrate supports, ignoring hysteresis. */
export function levelForBitrate(bitrate: number): number {
  const i = STREAM_LEVELS.findIndex((l) => bitrate >= l.floor);

  return i === -1 ? STREAM_LEVELS.length - 1 : i;
}

export class RemoteBitrateController {
  private readonly tuning: BitrateTuning;
  private bitrate: number;
  private levelIndex: number;
  private slowStart = true;
  private lastDecreaseAt = -Infinity;
  private lastLevelChangeAt: number;
  private lastUpshiftAt = -Infinity;
  private levelUpDwellMs: number;
  private cleanSince: number | null = null;
  private readonly prev = new Map<
    string,
    { sample: ViewerSample; at: number }
  >();
  private downshiftCount = 0;
  private lowestIndex: number;

  constructor(now: number, tuning: Partial<BitrateTuning> = {}) {
    this.tuning = { ...DEFAULT_TUNING, ...tuning };
    this.bitrate = this.tuning.start;
    this.levelIndex = levelForBitrate(this.bitrate);
    this.lowestIndex = this.levelIndex;
    this.lastLevelChangeAt = now;
    this.levelUpDwellMs = this.tuning.levelUpDwellMs;
  }

  get target(): StreamTarget {
    return { bitrate: this.bitrate, level: STREAM_LEVELS[this.levelIndex] };
  }

  /** Level drops and the worst level reached, for the session summary. */
  get stats(): { downshifts: number; lowest: StreamLevelName } {
    return {
      downshifts: this.downshiftCount,
      lowest: STREAM_LEVELS[this.lowestIndex].name,
    };
  }

  /**
   * A viewer left; its counters no longer count. It may have been the
   * bottleneck, so probe back up quickly rather than additively.
   */
  forget(viewerId: string): void {
    if (this.prev.delete(viewerId)) {
      this.slowStart = true;
    }
  }

  /**
   * Feed the latest sample of every viewer. Returns the new target when it
   * changed, else null. A viewer's first sample only sets its baseline.
   */
  update(
    now: number,
    samples: ReadonlyMap<string, ViewerSample>,
  ): StreamTarget | null {
    const congested: Assessment[] = [];
    let allClear = true;
    for (const [id, sample] of samples) {
      const prev = this.prev.get(id);
      this.prev.set(id, { sample, at: now });
      if (!prev) {
        allClear = false;
        continue;
      }
      const a = assessViewer(prev.sample, sample, now - prev.at, this.tuning);
      if (a.verdict === "congested") {
        congested.push(a);
      }
      if (a.verdict !== "clear") {
        allClear = false;
      }
    }
    if (samples.size === 0) {
      return null;
    }

    const before = this.target;
    if (congested.length > 0) {
      this.decrease(now, congested);
    } else if (allClear) {
      this.maybeIncrease(now);
    } else {
      this.cleanSince = null;
    }
    this.updateLevel(now);

    const after = this.target;

    return after.bitrate !== before.bitrate || after.level !== before.level
      ? after
      : null;
  }

  private decrease(now: number, congested: Assessment[]): void {
    this.cleanSince = null;
    this.slowStart = false;
    const since = now - this.lastDecreaseAt;
    if (
      since < this.tuning.holdAfterDecreaseMs ||
      (since < this.tuning.drainGraceMs && !congested.some((a) => a.worsening))
    ) {
      // The last cut is still draining the queue.
      return;
    }
    let next = this.bitrate * this.tuning.decrease;
    for (const a of congested) {
      if (a.throughput === null) {
        continue;
      }
      // Sit under what the link carried, minus enough to empty the queue.
      const drainRate = (a.buffered * 8 * 1000) / this.tuning.drainTargetMs;
      next = Math.min(
        next,
        Math.max(
          a.throughput * 0.5,
          a.throughput * this.tuning.throughputMargin - drainRate,
        ),
      );
    }
    this.bitrate = this.clamp(next);
    this.lastDecreaseAt = now;
  }

  private maybeIncrease(now: number): void {
    this.cleanSince ??= now;
    if (now - this.lastDecreaseAt < this.tuning.probeAfterDecreaseMs) {
      return;
    }
    const window = this.slowStart
      ? this.tuning.slowStartCleanMs
      : this.tuning.cleanBeforeIncreaseMs;
    if (now - this.cleanSince < window || this.bitrate >= this.tuning.max) {
      return;
    }
    const step = Math.min(
      this.tuning.maxIncreaseStep,
      Math.max(
        this.tuning.minIncreaseStep,
        this.bitrate * this.tuning.increaseShare,
      ),
    );
    this.bitrate = this.clamp(
      this.slowStart
        ? this.bitrate * this.tuning.slowStartFactor
        : this.bitrate + step,
    );
    // Each step needs a fresh clean window at the new rate.
    this.cleanSince = now;
  }

  private updateLevel(now: number): void {
    const best = levelForBitrate(this.bitrate);
    if (best > this.levelIndex) {
      // Too little bitrate for this resolution: step down at once. A step up
      // undone this quickly was a probe too far, so wait longer next time.
      this.levelUpDwellMs =
        now - this.lastUpshiftAt < this.tuning.maxLevelUpDwellMs / 4
          ? Math.min(this.levelUpDwellMs * 2, this.tuning.maxLevelUpDwellMs)
          : this.tuning.levelUpDwellMs;
      this.levelIndex = best;
      this.lastLevelChangeAt = now;
      this.downshiftCount += 1;
      this.lowestIndex = Math.max(this.lowestIndex, best);

      return;
    }
    if (best < this.levelIndex) {
      // One level at a time, with margin and dwell so a hovering link doesn't
      // rebuild the encoder back and forth.
      const up = STREAM_LEVELS[this.levelIndex - 1];
      if (
        this.bitrate >= up.floor * this.tuning.levelUpMargin &&
        now - this.lastLevelChangeAt >= this.levelUpDwellMs
      ) {
        this.levelIndex -= 1;
        this.lastLevelChangeAt = now;
        this.lastUpshiftAt = now;
      }
    }
  }

  private clamp(bitrate: number): number {
    const rounded = Math.round(bitrate / 10_000) * 10_000;

    return Math.min(this.tuning.max, Math.max(this.tuning.min, rounded));
  }
}
