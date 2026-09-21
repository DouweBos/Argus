/**
 * The refusal list, which exists so a gate is a question rather than a wall.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetHostEventSinks } from "@argus/host/bus";

const {
  clearGateLog,
  dismissGateLogEntry,
  listGateLog,
  recordGateRefusal,
  resetGateLogCache,
  suggestedEntryFor,
} = await import("./gateLog");

let home: string;
let previousHome: string | undefined;

function refusal(
  overrides: Partial<Parameters<typeof recordGateRefusal>[0]> = {},
) {
  recordGateRefusal({
    automationId: "a1",
    automationName: "Regression sweep",
    runId: "r1",
    toolName: "Bash",
    command: "conductor screenshot /tmp/a.png",
    ...overrides,
  });
}

describe("the gate log", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-gate-"));
    process.env.ARGUS_HOME = home;
    resetGateLogCache();
    resetHostEventSinks();
  });

  afterEach(() => {
    resetHostEventSinks();
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
  });

  it("suggests the command and its subcommand, not the whole line", () => {
    expect(suggestedEntryFor("conductor screenshot /tmp/a.png")).toBe(
      "conductor screenshot",
    );
    expect(suggestedEntryFor("gh pr list --json number")).toBe("gh pr");
    expect(suggestedEntryFor("/usr/local/bin/conductor ui")).toBe(
      "conductor ui",
    );
    expect(suggestedEntryFor("htop")).toBe("htop");
  });

  it("collapses the same refusal instead of logging it every morning", () => {
    refusal();
    refusal({ command: "conductor screenshot /tmp/b.png", runId: "r2" });

    const entries = listGateLog();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.count).toBe(2);
    // The newest context wins, since the old run is gone by the time you look.
    expect(entries[0]!.run_id).toBe("r2");
  });

  it("keeps different commands apart", () => {
    refusal();
    refusal({ command: "npm install left-pad" });

    expect(listGateLog()).toHaveLength(2);
  });

  it("records a refused tool under its own name", () => {
    refusal({ toolName: "mcp__argus__trigger_run", command: null });

    const [entry] = listGateLog();
    expect(entry!.kind).toBe("tool");
    expect(entry!.suggested_entry).toBe("mcp__argus__trigger_run");
  });

  it("forgets an entry once you have dealt with it", () => {
    refusal();
    const [entry] = listGateLog();

    dismissGateLogEntry(entry!.id);

    expect(listGateLog()).toEqual([]);
  });

  it("survives a reload, so a refusal at 07:30 is there at 09:00", () => {
    refusal();
    resetGateLogCache();

    expect(listGateLog()).toHaveLength(1);
  });

  it("clears on request", () => {
    refusal();
    clearGateLog();

    expect(listGateLog()).toEqual([]);
  });
});
