/**
 * What a phone is told about a run. The projection is narrow on purpose, so
 * the one bit that drives the unread dot has to survive it.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createRun,
  getAutomationRun,
  resetAutomationCache,
  updateRun,
} from "../automation/manager";
import { markRemoteRunRead, toRemoteAutomationRun } from "./automationsRemote";

let home: string;
let previousHome: string | undefined;

function runWithReport(): string {
  const run = createRun("a1", "running", "schedule 09:00");
  updateRun(run.id, {
    status: "succeeded",
    finished_at: Date.now(),
    report_markdown: "Nothing on fire.",
  });

  return run.id;
}

describe("the run a phone sees", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-remote-runs-"));
    process.env.ARGUS_HOME = home;
    resetAutomationCache();
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
    resetAutomationCache();
  });

  it("flags a report nobody has read", () => {
    const runId = runWithReport();

    const run = getAutomationRun(runId);

    expect(run && toRemoteAutomationRun(run).unread_report).toBe(true);
  });

  it("clears the flag when the phone opens it", () => {
    const runId = runWithReport();

    const marked = markRemoteRunRead(runId);

    expect(marked?.run.unread_report).toBe(false);
    expect(marked?.run.report_read).toBe(true);
  });

  it("never flags a run that wrote nothing", () => {
    const run = createRun("a1", "running", "manual");
    const failed = updateRun(run.id, {
      status: "failed",
      finished_at: Date.now(),
      error: "boom",
    });

    expect(toRemoteAutomationRun(failed).unread_report).toBe(false);
  });

  it("says nothing about a run it does not have", () => {
    expect(markRemoteRunRead("no-such-run")).toBeNull();
  });
});
