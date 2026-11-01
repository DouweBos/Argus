/**
 * What a phone is told about a run. The projection is narrow on purpose, so
 * the one bit that drives the unread dot has to survive it.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rememberStartOptions, resetStartOptions } from "../agent/startOptions";
import { DEFAULT_GUARDRAILS } from "../automation/guardrails";
import {
  createRun,
  getAutomationRun,
  resetAutomationCache,
  updateRun,
} from "../automation/manager";
import { listRunners } from "../llm/registry";
import {
  markRemoteRunRead,
  remoteRunners,
  remoteScratchRuns,
  toRemoteAutomationRun,
} from "./automationsRemote";

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

  it("previews the report's first line, kept short", () => {
    const run = getAutomationRun(runWithReport());
    expect(run && toRemoteAutomationRun(run).report_preview).toBe(
      "Nothing on fire.",
    );

    const long = updateRun(runWithReport(), {
      report_markdown: null,
      report_blocks: [
        { type: "markdown", text: `\n## ${"x".repeat(400)}\nmore` },
      ],
    });
    const preview = toRemoteAutomationRun(long).report_preview ?? "";
    expect(preview).toHaveLength(160);
    expect(preview.startsWith("xxx")).toBe(true);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("previews nothing for a run without a report", () => {
    const run = createRun("a1", "running", "manual");

    expect(toRemoteAutomationRun(run).report_preview).toBeNull();
  });

  it("says nothing about a run it does not have", () => {
    expect(markRemoteRunRead("no-such-run")).toBeNull();
  });

  it("lists only ad-hoc runs as quick-run history, capped by the limit", () => {
    createRun("a1", "succeeded", "schedule 09:00");
    const spec = {
      name: "Sweep",
      playbook: "Look around.",
      scope: { repo_roots: [] },
      source_ids: [],
      model: null,
      guardrails: DEFAULT_GUARDRAILS,
    };
    const first = createRun("scratch-1", "succeeded", "manual", null, spec);
    const second = createRun("scratch-2", "succeeded", "manual", null, spec);

    const ids = remoteScratchRuns({}).runs.map((r) => r.id);

    expect(new Set(ids)).toEqual(new Set([first.id, second.id]));
    expect(remoteScratchRuns({ limit: 1 }).runs).toHaveLength(1);
  });
});

describe("the runners a phone sees", () => {
  afterEach(() => resetStartOptions());

  it("carries the models a runner last reported, for a start before any agent", () => {
    const runner = listRunners()[0];
    expect(runner).toBeDefined();
    rememberStartOptions(runner.id, {
      commands: [],
      models: [
        {
          value: "haiku",
          displayName: "Haiku",
          description: "",
          supportedEffortLevels: ["low", "high"],
          extra: "dropped",
        },
      ],
    });

    const listed = remoteRunners().runners.find((r) => r.id === runner.id);

    expect(listed?.reported_models).toEqual([
      {
        value: "haiku",
        displayName: "Haiku",
        description: "",
        supportedEffortLevels: ["low", "high"],
      },
    ]);
  });
});
