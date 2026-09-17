/**
 * The two behaviours that matter more than the timer: a closed laptop
 * produces one catch-up run rather than one per missed window, and a fire
 * landing on top of a live run is recorded as skipped instead of starting a
 * second host.
 */

import type { Automation } from "./models";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@argus/host/bus", () => ({ emitHostEvent: vi.fn() }));
const startAutomationRun = vi.fn();
vi.mock("./runner", () => ({ startAutomationRun }));

const {
  createAutomation,
  createRun,
  getAutomation,
  listAutomationRuns,
  resetAutomationCache,
  updateAutomation,
} = await import("./manager");
const { tickAutomations } = await import("./scheduler");

const HOUR = 60 * 60 * 1000;
let home: string;
let previousHome: string | undefined;

/** An automation firing every 30 minutes, with its clock set by the caller. */
function hourly(options: { catchUp?: boolean; dueAt: number }): Automation {
  const automation = createAutomation({
    name: "Every thirty",
    enabled: true,
    playbook: "report",
    trigger: {
      kind: "schedule",
      cron: "*/30 * * * *",
      timezone: "UTC",
      catch_up: options.catchUp ?? true,
    },
  });

  return updateAutomation(automation.id, { next_run_at: options.dueAt });
}

describe("tickAutomations", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-scheduler-"));
    process.env.ARGUS_HOME = home;
    resetAutomationCache();
    startAutomationRun.mockReset();
    startAutomationRun.mockImplementation((automationId: string) =>
      createRun(automationId, "running", "test"),
    );
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
  });

  it("fires an automation that has come due", () => {
    const now = Date.parse("2026-04-01T10:00:20Z");
    hourly({ dueAt: now - 20_000 });

    tickAutomations(now);

    expect(startAutomationRun).toHaveBeenCalledTimes(1);
    expect(startAutomationRun.mock.calls[0][1]).toContain("schedule");
  });

  it("leaves an automation that is not due yet alone", () => {
    const now = Date.parse("2026-04-01T10:00:00Z");
    hourly({ dueAt: now + HOUR });

    tickAutomations(now);

    expect(startAutomationRun).not.toHaveBeenCalled();
  });

  it("ignores disabled automations and manual triggers", () => {
    const now = Date.parse("2026-04-01T10:00:00Z");
    const scheduled = hourly({ dueAt: now - 1000 });
    updateAutomation(scheduled.id, { enabled: false });
    createAutomation({
      name: "Manual only",
      enabled: true,
      playbook: "report",
      trigger: { kind: "manual" },
    });

    tickAutomations(now);

    expect(startAutomationRun).not.toHaveBeenCalled();
  });

  it("coalesces a night of missed fires into one catch-up run", () => {
    const now = Date.parse("2026-04-01T08:00:10Z");
    // Due at midnight: sixteen 30-minute windows went by while asleep.
    const automation = hourly({ dueAt: now - 8 * HOUR });

    tickAutomations(now);

    expect(startAutomationRun).toHaveBeenCalledTimes(1);
    expect(startAutomationRun.mock.calls[0][1]).toContain("catch-up");

    // And the clock has moved past `now`, so the next tick does nothing.
    const next = getAutomation(automation.id)?.next_run_at ?? 0;
    expect(next).toBeGreaterThan(now);
    tickAutomations(now + 1000);
    expect(startAutomationRun).toHaveBeenCalledTimes(1);
  });

  it("does not fire at all when a missed automation opted out of catch-up", () => {
    const now = Date.parse("2026-04-01T08:00:10Z");
    const automation = hourly({ catchUp: false, dueAt: now - 8 * HOUR });

    tickAutomations(now);

    expect(startAutomationRun).not.toHaveBeenCalled();
    expect(listAutomationRuns(automation.id)).toHaveLength(0);
    expect(getAutomation(automation.id)?.next_run_at).toBeGreaterThan(now);
  });

  it("records a skipped run rather than starting a second host", () => {
    const now = Date.parse("2026-04-01T10:00:10Z");
    const automation = hourly({ dueAt: now - 10_000 });
    createRun(automation.id, "running", "earlier fire");

    tickAutomations(now);

    expect(startAutomationRun).not.toHaveBeenCalled();
    const runs = listAutomationRuns(automation.id);
    expect(runs.map((r) => r.status)).toContain("skipped");
    expect(runs.find((r) => r.status === "skipped")?.error).toMatch(
      /still in progress/,
    );
    // Rescheduled, so the next tick does not pile up another skip.
    expect(getAutomation(automation.id)?.next_run_at).toBeGreaterThan(now);
  });

  it("gives a newly enabled automation a clock without firing it", () => {
    const now = Date.parse("2026-04-01T10:00:00Z");
    const automation = hourly({ dueAt: now + HOUR });
    updateAutomation(automation.id, { next_run_at: null });

    tickAutomations(now);

    expect(startAutomationRun).not.toHaveBeenCalled();
    expect(getAutomation(automation.id)?.next_run_at).toBeGreaterThan(now);
  });

  it("does nothing while automations are switched off app-wide", () => {
    fs.writeFileSync(
      path.join(home, "app-settings.json"),
      JSON.stringify({ version: 1, settings: { automations_enabled: false } }),
    );
    const now = Date.parse("2026-04-01T10:00:10Z");
    hourly({ dueAt: now - 10_000 });

    tickAutomations(now);

    expect(startAutomationRun).not.toHaveBeenCalled();
  });
});
