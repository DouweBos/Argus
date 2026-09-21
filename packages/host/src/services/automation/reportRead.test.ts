/**
 * Unread reports: a newer report retires the one before it, and opening a
 * report retires it by hand.
 */

import type { AutomationRun, ScratchSpec } from "./models";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GUARDRAILS } from "./guardrails";
import {
  createRun,
  getAutomationRun,
  listAutomationRuns,
  markRunReportRead,
  resetAutomationCache,
  updateRun,
} from "./manager";

let home: string;
let previousHome: string | undefined;

function report(runId: string): AutomationRun {
  return updateRun(runId, {
    status: "succeeded",
    finished_at: Date.now(),
    report_markdown: "Nothing on fire.",
  });
}

function scratchSpec(name: string): ScratchSpec {
  return {
    name,
    playbook: "do it",
    scope: { repo_roots: [] },
    source_ids: [],
    model: null,
    guardrails: DEFAULT_GUARDRAILS,
  };
}

describe("automation report read state", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-report-read-"));
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

  it("starts a run unread", () => {
    const run = createRun("a1", "running", "manual");
    expect(run.report_read).toBe(false);
  });

  it("reads the previous report once a newer one lands", () => {
    const first = createRun("a1", "running", "manual");
    report(first.id);
    const second = createRun("a1", "running", "manual");

    expect(getAutomationRun(first.id)?.report_read).toBe(false);

    report(second.id);

    expect(getAutomationRun(first.id)?.report_read).toBe(true);
    expect(getAutomationRun(second.id)?.report_read).toBe(false);
  });

  it("leaves another automation's report alone", () => {
    const other = createRun("a2", "running", "manual");
    report(other.id);
    const mine = createRun("a1", "running", "manual");
    report(mine.id);

    expect(getAutomationRun(other.id)?.report_read).toBe(false);
  });

  it("does not retire the previous report until the new one has one", () => {
    const first = createRun("a1", "running", "manual");
    report(first.id);
    const second = createRun("a1", "running", "manual");
    updateRun(second.id, { status: "failed", error: "boom" });

    expect(getAutomationRun(first.id)?.report_read).toBe(false);
  });

  it("leaves an earlier quick run alone — they share a cap, not an identity", () => {
    const first = createRun(
      "scratch-1",
      "running",
      "manual",
      null,
      scratchSpec("Audit deps"),
    );
    report(first.id);
    const second = createRun(
      "scratch-2",
      "running",
      "manual",
      null,
      scratchSpec("Something unrelated"),
    );
    report(second.id);

    expect(getAutomationRun(first.id)?.report_read).toBe(false);
  });

  it("marks one read, and says so again without failing", () => {
    const run = createRun("a1", "running", "manual");
    report(run.id);

    expect(markRunReportRead(run.id).report_read).toBe(true);
    expect(markRunReportRead(run.id).report_read).toBe(true);
  });

  it("treats history written before the field as already read", () => {
    fs.writeFileSync(
      path.join(home, "automation-runs.json"),
      JSON.stringify({
        version: 1,
        runs: [
          {
            id: "old",
            automation_id: "a1",
            scratch: null,
            status: "succeeded",
            trigger_reason: "manual",
            started_at: 1,
            finished_at: 2,
            host_session_id: null,
            host_agent_id: null,
            cost_usd: null,
            report_markdown: "Yesterday's news.",
            report_blocks: null,
            error: null,
          },
        ],
      }),
    );
    resetAutomationCache();

    expect(listAutomationRuns()[0].report_read).toBe(true);
  });
});
