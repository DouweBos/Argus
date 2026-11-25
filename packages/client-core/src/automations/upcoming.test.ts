import type { UpcomingRun } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import {
  untilLabel,
  upcomingSubtitle,
  upcomingWaitLabel,
  upcomingWhen,
} from "./upcoming";

const now = new Date(2026, 10, 25, 12, 0);
const HOUR = 3_600_000;

function run(patch: Partial<UpcomingRun> = {}): UpcomingRun {
  return {
    automation_id: "a1",
    name: "Nightly triage",
    teammate_id: null,
    teammate_name: null,
    trigger_kind: "schedule",
    next_run_at: now.getTime() + 2 * HOUR,
    waiting: null,
    waiting_until: null,
    ...patch,
  };
}

describe("upcoming labels", () => {
  it("counts down to the run", () => {
    expect(untilLabel(now.getTime() - 1, now)).toBe("now");
    expect(untilLabel(now.getTime() + 10_000, now)).toBe("in 1m");
    expect(untilLabel(now.getTime() + 2 * HOUR, now)).toBe("in 2h");
    expect(untilLabel(now.getTime() + 72 * HOUR, now)).toBe("in 3d");
    expect(upcomingWhen(run(), now)).toMatch(/^in 2h · at /);
  });

  it("says what each run waits on", () => {
    expect(upcomingWaitLabel(run(), now)).toBeNull();
    expect(upcomingWaitLabel(run({ waiting: "paused" }), now)).toBe("Paused");
    expect(upcomingWaitLabel(run({ waiting: "approval" }), now)).toBe(
      "Waits for your approval on the run still going",
    );
    expect(upcomingWaitLabel(run({ waiting: "overlap" }), now)).toBe(
      "Skipped if the run still going hasn't finished",
    );
    expect(upcomingWaitLabel(run({ waiting: "limit" }), now)).toBe(
      "Waits for the usage limit to reset",
    );
    expect(
      upcomingWaitLabel(
        run({ waiting: "limit", waiting_until: now.getTime() + HOUR }),
        now,
      ),
    ).toMatch(/^Waits for the usage limit to reset at /);
  });

  it("names whose run it is", () => {
    expect(upcomingSubtitle(run())).toBe("Automation");
    expect(
      upcomingSubtitle(
        run({ teammate_name: "CI Fixer", trigger_kind: "once" }),
      ),
    ).toBe("Once · CI Fixer's duty");
  });
});
