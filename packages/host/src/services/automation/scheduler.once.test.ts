/** A one-time trigger fires once under the same catch-up rules, then pauses. */

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

const AT = "2030-03-04T09:00";
const DUE = Date.parse("2030-03-04T08:00:00Z");
let home: string;
let previousHome: string | undefined;

function once(catchUp = true): string {
  return createAutomation({
    name: "Recheck CI",
    enabled: true,
    playbook: "report",
    trigger: {
      kind: "once",
      at: AT,
      timezone: "Europe/Amsterdam",
      catch_up: catchUp,
    },
  }).id;
}

describe("one-time trigger", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-once-"));
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

  it("is due at its wall-clock time in its zone", () => {
    expect(getAutomation(once())?.next_run_at).toBe(DUE);
  });

  it("fires once, then pauses itself", () => {
    const id = once();

    tickAutomations(DUE - 30_000);
    expect(startAutomationRun).not.toHaveBeenCalled();

    tickAutomations(DUE + 10_000);
    tickAutomations(DUE + 40_000);

    expect(startAutomationRun).toHaveBeenCalledTimes(1);
    expect(startAutomationRun.mock.calls[0][1]).toBe("once 09:00");
    expect(getAutomation(id)).toMatchObject({
      enabled: false,
      next_run_at: null,
    });
  });

  it("catches up after sleeping through it when asked to", () => {
    once(true);

    tickAutomations(DUE + 6 * 60 * 60 * 1000);

    expect(startAutomationRun).toHaveBeenCalledTimes(1);
    expect(startAutomationRun.mock.calls[0][1]).toContain("catch-up");
  });

  it("is dropped, not run late, without catch-up", () => {
    const id = once(false);

    tickAutomations(DUE + 6 * 60 * 60 * 1000);

    expect(startAutomationRun).not.toHaveBeenCalled();
    expect(getAutomation(id)?.enabled).toBe(false);
  });

  it("records a skip when a run is still going, and stays spent", () => {
    const id = once();
    createRun(id, "running", "manual");

    tickAutomations(DUE + 10_000);

    expect(startAutomationRun).not.toHaveBeenCalled();
    expect(listAutomationRuns(id).map((r) => r.status)).toContain("skipped");
    expect(getAutomation(id)?.enabled).toBe(false);
  });

  it("refuses to be armed for a time already gone", () => {
    const id = once();
    tickAutomations(DUE + 10_000);
    vi.useFakeTimers({ now: DUE + 10 * 60_000 });
    try {
      expect(() => updateAutomation(id, { enabled: true })).toThrow(/passed/);
      // Editing anything else on the spent automation still saves.
      expect(updateAutomation(id, { name: "Renamed" }).name).toBe("Renamed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a time that is not a date and time", () => {
    expect(() =>
      createAutomation({
        name: "Bad",
        playbook: "report",
        trigger: {
          kind: "once",
          at: "tomorrow",
          timezone: "UTC",
          catch_up: true,
        },
      }),
    ).toThrow(/Invalid run-once time/);
  });
});
