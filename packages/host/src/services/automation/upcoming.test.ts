import type { Automation, AutomationRun } from "./models";
import { describe, expect, it } from "vitest";
import { computeUpcoming, type UpcomingInputs } from "./upcoming";

const NOW = Date.UTC(2026, 10, 25, 12, 0);
const HOUR = 3_600_000;

function automation(id: string, patch: Partial<Automation> = {}): Automation {
  return {
    id,
    name: id,
    enabled: true,
    trigger: {
      kind: "schedule",
      cron: "0 * * * *",
      timezone: "UTC",
      catch_up: false,
    },
    teammate_id: null,
    runner: null,
    claude_account_id: null,
    next_run_at: NOW + HOUR,
    ...patch,
  } as Automation;
}

function inputs(patch: Partial<UpcomingInputs>): UpcomingInputs {
  return {
    automations: [],
    teammates: [],
    automationsEnabled: true,
    teammatesActive: true,
    activeRuns: [],
    awaitingApproval: () => false,
    limit: () => null,
    now: NOW,
    ...patch,
  };
}

const running = (automationId: string, agentId: string | null = null) =>
  ({
    automation_id: automationId,
    status: "running",
    host_agent_id: agentId,
  }) as AutomationRun;

describe("upcoming runs", () => {
  it("lists scheduled runs soonest first and leaves out event triggers", () => {
    const runs = computeUpcoming(
      inputs({
        automations: [
          automation("later", { next_run_at: NOW + 3 * HOUR }),
          automation("soon", { next_run_at: NOW + 10 * 60_000 }),
          automation("on-signal", {
            trigger: { kind: "manual" },
            next_run_at: null,
          }),
        ],
      }),
    );

    expect(runs.map((r) => [r.name, r.waiting])).toEqual([
      ["soon", null],
      ["later", null],
    ]);
  });

  it("says what each run waits on, approval before a run still going", () => {
    const runs = computeUpcoming(
      inputs({
        automations: [
          automation("overlap", { next_run_at: NOW + 1 }),
          automation("approval", { next_run_at: NOW + 2 }),
          automation("limit", { next_run_at: NOW + 3 }),
        ],
        activeRuns: [running("overlap"), running("approval", "agent-1")],
        awaitingApproval: (agentId) => agentId === "agent-1",
        limit: (a) => (a.id === "limit" ? { resetsAt: NOW + 2 * HOUR } : null),
      }),
    );

    expect(runs.map((r) => [r.name, r.waiting, r.waiting_until])).toEqual([
      ["overlap", "overlap", null],
      ["approval", "approval", null],
      ["limit", "limit", NOW + 2 * HOUR],
    ]);
  });

  it("shows a paused automation or duty at the time it would run", () => {
    const runs = computeUpcoming(
      inputs({
        automations: [
          automation("a-off", { enabled: false, next_run_at: null }),
          automation("duty", {
            teammate_id: "t1",
            next_run_at: NOW + 2 * HOUR,
          }),
        ],
        teammates: [{ id: "t1", name: "CI Fixer", enabled: false }],
        limit: () => ({ resetsAt: null }),
      }),
    );

    expect(runs).toEqual([
      expect.objectContaining({
        name: "a-off",
        next_run_at: Date.UTC(2026, 10, 25, 13, 0),
        waiting: "paused",
      }),
      expect.objectContaining({
        name: "duty",
        teammate_name: "CI Fixer",
        waiting: "paused",
      }),
    ]);
  });

  it("pauses everything when automations are off", () => {
    const runs = computeUpcoming(
      inputs({ automations: [automation("a")], automationsEnabled: false }),
    );

    expect(runs[0]?.waiting).toBe("paused");
  });

  it("drops a one-time trigger that already fired", () => {
    const once = (at: string, enabled: boolean) =>
      automation(at, {
        enabled,
        trigger: { kind: "once", at, timezone: "UTC", catch_up: false },
        next_run_at: null,
      });

    const runs = computeUpcoming(
      inputs({
        automations: [
          once("2026-11-25T09:00", false),
          once("2026-11-26T09:00", false),
        ],
      }),
    );

    expect(runs.map((r) => [r.name, r.waiting])).toEqual([
      ["2026-11-26T09:00", "paused"],
    ]);
  });
});
