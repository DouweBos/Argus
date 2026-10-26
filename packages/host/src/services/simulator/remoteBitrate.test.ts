import { describe, expect, it } from "vitest";
import {
  assessViewer,
  levelForBitrate,
  RemoteBitrateController,
  STREAM_LEVELS,
  type ViewerSample,
} from "./remoteBitrate";

const TICK = 500;

/** A viewer whose link carries `capacity` bits/s while we send `rate`. */
class FakeLink {
  sample: ViewerSample = { buffered: 0, sentBytes: 0, dropped: 0 };
  constructor(public capacity: number) {}

  step(rate: number, ms: number): ViewerSample {
    const sent = (rate * ms) / 8000;
    const drained = Math.min(
      this.sample.buffered + sent,
      (this.capacity * ms) / 8000,
    );
    let buffered = this.sample.buffered + sent - drained;
    let dropped = this.sample.dropped;
    if (buffered > 1_000_000) {
      dropped += 1;
      buffered = 1_000_000;
    }
    this.sample = {
      buffered,
      sentBytes: this.sample.sentBytes + sent,
      dropped,
    };

    return this.sample;
  }
}

function run(
  ctl: RemoteBitrateController,
  links: Record<string, FakeLink>,
  from: number,
  ms: number,
): number {
  let now = from;
  for (; now < from + ms; now += TICK) {
    const samples = new Map<string, ViewerSample>();
    for (const [id, link] of Object.entries(links)) {
      samples.set(id, link.step(ctl.target.bitrate, TICK));
    }
    ctl.update(now, samples);
  }

  return now;
}

describe("assessViewer", () => {
  const empty = { buffered: 0, sentBytes: 0, dropped: 0 };

  it("is clear when the queue stays empty", () => {
    const a = assessViewer(
      empty,
      { buffered: 0, sentBytes: 100_000, dropped: 0 },
      TICK,
    );
    expect(a.verdict).toBe("clear");
    expect(a.throughput).toBe(1_600_000);
  });

  it("is congested on any dropped frame", () => {
    expect(
      assessViewer(empty, { buffered: 0, sentBytes: 0, dropped: 1 }, TICK)
        .verdict,
    ).toBe("congested");
  });

  it("tolerates a keyframe burst that drains quickly", () => {
    // 100 KB queued, but 2 MB left the queue in the same half second.
    const a = assessViewer(
      empty,
      { buffered: 100_000, sentBytes: 2_100_000, dropped: 0 },
      TICK,
    );
    expect(a.verdict).toBe("neutral");
  });

  it("is congested when the queue would take too long to drain", () => {
    const a = assessViewer(
      empty,
      { buffered: 200_000, sentBytes: 250_000, dropped: 0 },
      TICK,
    );
    expect(a.verdict).toBe("congested");
    expect(a.throughput).toBe(800_000);
  });
});

describe("levelForBitrate", () => {
  it("picks the best level whose floor the bitrate clears", () => {
    expect(STREAM_LEVELS[levelForBitrate(8_000_000)].name).toBe("full");
    expect(STREAM_LEVELS[levelForBitrate(2_000_000)].name).toBe("high");
    expect(STREAM_LEVELS[levelForBitrate(800_000)].name).toBe("medium");
    expect(STREAM_LEVELS[levelForBitrate(100_000)].name).toBe("low");
  });
});

describe("remote bitrate controller", () => {
  it("ramps a fast link up to full quality", () => {
    const ctl = new RemoteBitrateController(0);
    run(ctl, { phone: new FakeLink(50_000_000) }, 0, 20_000);
    expect(ctl.target.bitrate).toBe(8_000_000);
    expect(ctl.target.level.name).toBe("full");
    expect(ctl.stats.downshifts).toBe(0);
  });

  it("backs off quickly to what a slow link carries", () => {
    const ctl = new RemoteBitrateController(0);
    run(ctl, { phone: new FakeLink(800_000) }, 0, 6_000);
    expect(ctl.target.bitrate).toBeLessThanOrEqual(800_000);
    expect(ctl.target.level.name).not.toBe("full");
    expect(ctl.stats.downshifts).toBeGreaterThan(0);
  });

  it("settles near capacity instead of collapsing", () => {
    const ctl = new RemoteBitrateController(0);
    const link = new FakeLink(3_000_000);
    let now = run(ctl, { phone: link }, 0, 30_000);
    const seen: number[] = [];
    for (let i = 0; i < 60; i++) {
      now = run(ctl, { phone: link }, now, TICK);
      seen.push(ctl.target.bitrate);
    }
    const avg = seen.reduce((a, b) => a + b, 0) / seen.length;
    expect(avg).toBeGreaterThan(1_200_000);
    expect(Math.max(...seen)).toBeLessThanOrEqual(4_000_000);
  });

  it("follows the most congested viewer", () => {
    const ctl = new RemoteBitrateController(0);
    run(
      ctl,
      { wifi: new FakeLink(50_000_000), cell: new FakeLink(600_000) },
      0,
      8_000,
    );
    expect(ctl.target.bitrate).toBeLessThanOrEqual(600_000);
  });

  it("probes back up once the congested viewer leaves", () => {
    const ctl = new RemoteBitrateController(0);
    const wifi = new FakeLink(50_000_000);
    const now = run(ctl, { wifi, cell: new FakeLink(600_000) }, 0, 8_000);
    const low = ctl.target.bitrate;
    ctl.forget("cell");
    run(ctl, { wifi }, now, 30_000);
    expect(ctl.target.bitrate).toBeGreaterThan(low * 3);
    expect(ctl.target.level.name).toBe("full");
  });

  it("does not flap the level when the bitrate hovers at a boundary", () => {
    const ctl = new RemoteBitrateController(0, { start: 3_000_000 });
    expect(ctl.target.level.name).toBe("full");
    const quiet = new Map([["p", { buffered: 0, sentBytes: 0, dropped: 0 }]]);
    ctl.update(0, quiet);
    // One cut takes it below the full floor…
    const cut = ctl.update(
      500,
      new Map([["p", { buffered: 0, sentBytes: 0, dropped: 1 }]]),
    );
    expect(cut?.level.name).toBe("high");
    // …and a later recovery to just above the floor isn't enough to step back.
    const hovering: string[] = [];
    let sent = 0;
    for (let now = 1_000; now < 20_000; now += TICK) {
      sent += 100_000;
      ctl.update(
        now,
        new Map([["p", { buffered: 0, sentBytes: sent, dropped: 1 }]]),
      );
      const { bitrate, level } = ctl.target;
      if (bitrate >= 3_000_000 && bitrate < 3_900_000) {
        hovering.push(level.name);
      }
    }
    expect(hovering.length).toBeGreaterThan(0);
    expect(new Set(hovering)).toEqual(new Set(["high"]));
  });

  it("cuts at most once per hold window", () => {
    const ctl = new RemoteBitrateController(0, { start: 4_000_000 });
    ctl.update(0, new Map([["p", { buffered: 0, sentBytes: 0, dropped: 0 }]]));
    ctl.update(
      100,
      new Map([["p", { buffered: 0, sentBytes: 0, dropped: 1 }]]),
    );
    const afterFirst = ctl.target.bitrate;
    ctl.update(
      200,
      new Map([["p", { buffered: 0, sentBytes: 0, dropped: 2 }]]),
    );
    expect(ctl.target.bitrate).toBe(afterFirst);
    expect(afterFirst).toBe(2_400_000);
  });

  it("reports nothing without viewers", () => {
    const ctl = new RemoteBitrateController(0);
    expect(ctl.update(1_000, new Map())).toBeNull();
  });
});
