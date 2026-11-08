import { describe, expect, it } from "vitest";
import { heapLimitBucket, heapUsedBucket, uptimeBucket } from "./heapSample";

const MB = 1024 * 1024;

describe("heap sample buckets", () => {
  it("buckets heap use", () => {
    expect(heapUsedBucket(100 * MB)).toBe("<256MB");
    expect(heapUsedBucket(700 * MB)).toBe("<1GB");
    expect(heapUsedBucket(3000 * MB)).toBe("<4GB");
    expect(heapUsedBucket(4100 * MB)).toBe(">=4GB");
  });

  it("buckets the share of the heap limit", () => {
    expect(heapLimitBucket(1, 0)).toBe("<25%");
    expect(heapLimitBucket(40, 100)).toBe("<50%");
    expect(heapLimitBucket(80, 100)).toBe(">=75%");
  });

  it("buckets uptime", () => {
    expect(uptimeBucket(3600)).toBe("<6h");
    expect(uptimeBucket(30 * 3600)).toBe("<3d");
    expect(uptimeBucket(70 * 3600)).toBe("<3d");
    expect(uptimeBucket(80 * 3600)).toBe(">=3d");
  });
});
