import { describe, expect, it } from "vitest";
import {
  clockTimeLabel,
  threadFailureDetail,
  threadFailureTitle,
} from "./teammateFailure";

describe("teammate thread failure labels", () => {
  it("titles each kind", () => {
    expect(threadFailureTitle("limit")).toBe("Stopped at the usage limit");
    expect(threadFailureTitle("interrupted")).toBe("Interrupted by a restart");
    expect(threadFailureTitle("error")).toBe("Stopped with an error");
  });

  it("adds the reset time to a limit's reason", () => {
    const now = new Date(2026, 10, 25, 9, 0);
    const later = new Date(2026, 10, 25, 14, 5).getTime();
    const detail = threadFailureDetail(
      {
        kind: "limit",
        reason: "Hit the usage limit.",
        at: 0,
        resets_at: later,
      },
      now,
    );
    expect(detail).toMatch(/^Hit the usage limit\. It resets at .+\.$/);
    expect(
      threadFailureDetail(
        { kind: "error", reason: "Boom.", at: 0, resets_at: null },
        now,
      ),
    ).toBe("Boom.");
  });

  it("names the day when the time isn't today", () => {
    const now = new Date(2026, 10, 25, 9, 0);
    expect(clockTimeLabel(new Date(2026, 10, 26, 8, 0).getTime(), now)).toMatch(
      /^\S+ at /,
    );
    expect(
      clockTimeLabel(new Date(2026, 10, 25, 18, 0).getTime(), now),
    ).toMatch(/^at /);
  });
});
