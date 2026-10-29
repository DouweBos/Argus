import { describe, expect, it } from "vitest";
import { backgroundTaskLabel, formatTaskDuration } from "./backgroundTask";

describe("background task labels", () => {
  it("formats durations like the Mac app", () => {
    expect(formatTaskDuration(29_700)).toBe("29s");
    expect(formatTaskDuration(329_000)).toBe("5m 29s");
    expect(formatTaskDuration(3_840_000)).toBe("1h 4m");
    expect(formatTaskDuration(-3)).toBe("0s");
  });

  it("reads live while running and as an outcome once settled", () => {
    expect(
      backgroundTaskLabel({ status: "running", startedAt: 0 }, 252_000),
    ).toBe("Running · 4m 12s");
    expect(
      backgroundTaskLabel(
        { status: "completed", startedAt: 0, durationMs: 1_121_000 },
        0,
      ),
    ).toBe("Done in 18m 41s");
    expect(
      backgroundTaskLabel(
        { status: "failed", startedAt: 0, durationMs: 3_000 },
        0,
      ),
    ).toBe("Failed after 3s");
    expect(
      backgroundTaskLabel(
        { status: "stopped", startedAt: 0, durationMs: 60_000 },
        0,
      ),
    ).toBe("Stopped after 1m 0s");
  });
});
