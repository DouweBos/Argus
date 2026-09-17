import { describe, expect, it } from "vitest";
import {
  cronError,
  formatDuration,
  nextFireTimes,
  nextRunLabel,
  triggerLabel,
} from "./automations";

const START = Date.UTC(2026, 8, 17, 9, 0, 0);

function minutesOf(times: number[]): number[] {
  return times.map((t) => new Date(t).getUTCMinutes());
}

describe("cron preview", () => {
  it("tells every-five-minutes apart from five-past-the-hour", () => {
    expect(minutesOf(nextFireTimes("*/5 * * * *", "UTC", 4, START))).toEqual([
      5, 10, 15, 20,
    ]);
    expect(minutesOf(nextFireTimes("5 * * * *", "UTC", 4, START))).toEqual([
      5, 5, 5, 5,
    ]);
  });

  it("returns nothing for an expression that does not parse", () => {
    expect(nextFireTimes("not a cron", "UTC", 3, START)).toEqual([]);
    expect(cronError("not a cron", "UTC")).toContain("Five fields");
  });

  it("accepts a valid expression", () => {
    expect(cronError("0 9 * * 1-5", "UTC")).toBeNull();
  });
});

describe("labels", () => {
  it("names a manual trigger", () => {
    expect(triggerLabel({ kind: "manual" })).toBe("Manual only");
  });

  it("shows the cron and its zone", () => {
    expect(
      triggerLabel({
        kind: "schedule",
        cron: "0 9 * * 1-5",
        timezone: "UTC",
        catch_up: true,
      }),
    ).toBe("0 9 * * 1-5 · UTC");
  });

  it("says Paused rather than pretending a disabled schedule will fire", () => {
    expect(
      nextRunLabel({
        id: "a",
        name: "n",
        description: "",
        enabled: false,
        playbook: "",
        model: null,
        template_id: null,
        trigger: {
          kind: "schedule",
          cron: "0 9 * * *",
          timezone: "UTC",
          catch_up: false,
        },
        scope: { repo_roots: [] },
        created_at: 0,
        updated_at: 0,
        last_run_at: null,
        next_run_at: START,
      }),
    ).toBe("Paused");
  });

  it("counts a still-running run up from its start", () => {
    const run = {
      id: "r",
      automation_id: "a",
      status: "running" as const,
      trigger_reason: "manual",
      started_at: START,
      finished_at: null,
      host_session_id: null,
      host_agent_id: null,
      cost_usd: null,
      report_markdown: null,
      error: null,
    };
    expect(formatDuration(run, START + 90_000)).toBe("1m 30s");
  });
});
