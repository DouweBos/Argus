/**
 * Deleting a run is the one automation operation with nothing to fall back
 * on, so it has to be exact: the right record, its directory, its proposals —
 * and never a run that is still writing.
 */

import type { AutomationRun } from "./models";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteRun, listAutomationRuns, resetAutomationCache } from "./manager";
import { automationRunDir } from "./paths";
import { saveAutomationRuns } from "./store";

let home: string;
let previousHome: string | undefined;

function run(id: string, status: AutomationRun["status"]): AutomationRun {
  return {
    id,
    automation_id: "a1",
    scratch: null,
    status,
    trigger_reason: "manual",
    started_at: 1,
    finished_at: status === "running" ? null : 2,
    host_session_id: null,
    host_agent_id: null,
    cost_usd: null,
    report_markdown: "# report",
    report_blocks: null,
    report_read: false,
    error: null,
    feedback: [],
  };
}

describe("deleteRun", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-delete-run-"));
    process.env.ARGUS_HOME = home;
    resetAutomationCache();
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    resetAutomationCache();
    fs.rmSync(home, { force: true, recursive: true });
  });

  it("removes the run and its working directory", () => {
    saveAutomationRuns([run("r1", "succeeded"), run("r2", "failed")]);
    resetAutomationCache();
    const dir = automationRunDir("a1", "r1");
    fs.mkdirSync(dir, { recursive: true });

    deleteRun("r1");

    expect(listAutomationRuns("a1").map((r) => r.id)).toEqual(["r2"]);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("refuses while the run is still going", () => {
    saveAutomationRuns([run("r1", "running")]);
    resetAutomationCache();

    expect(() => deleteRun("r1")).toThrow();
    expect(listAutomationRuns("a1")).toHaveLength(1);
  });

  it("says so when the run is not there", () => {
    expect(() => deleteRun("nope")).toThrow();
  });
});
