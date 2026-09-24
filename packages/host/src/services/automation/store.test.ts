/**
 * Persistence: the round trip, the `.bak` on a schema mismatch, and the run
 * cap that keeps the history file from growing forever.
 */

import type { Automation, AutomationRun } from "./models";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GUARDRAILS } from "./guardrails";
import {
  MAX_RUNS_PER_AUTOMATION,
  loadAutomationRuns,
  loadAutomations,
  saveAutomationRuns,
  saveAutomations,
} from "./store";

let home: string;
let previousHome: string | undefined;

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "a1",
    name: "Standup digest",
    description: "",
    enabled: true,
    trigger: {
      kind: "schedule",
      cron: "0 9 * * *",
      timezone: "UTC",
      catch_up: true,
    },
    scope: { repo_roots: ["/repo"] },
    source_ids: [],
    playbook: "do the thing",
    autonomy: null,
    guardrails: DEFAULT_GUARDRAILS,
    model: null,
    runner: null,
    template_id: "standup-digest",
    seeded_playbook_hash: null,
    created_at: 1,
    updated_at: 1,
    last_run_at: null,
    next_run_at: 2,
    ...overrides,
  };
}

function run(
  id: string,
  startedAt: number,
  automationId = "a1",
): AutomationRun {
  return {
    id,
    automation_id: automationId,
    scratch: null,
    status: "succeeded",
    trigger_reason: "manual",
    started_at: startedAt,
    finished_at: startedAt + 1,
    host_session_id: null,
    host_agent_id: null,
    cost_usd: null,
    report_markdown: null,
    report_blocks: null,
    report_read: false,
    error: null,
  };
}

function scratchRun(id: string, startedAt: number): AutomationRun {
  return {
    ...run(id, startedAt, `scratch-${id}`),
    scratch: {
      name: "Quick run",
      playbook: "do it",
      scope: { repo_roots: [] },
      source_ids: [],
      model: null,
      guardrails: DEFAULT_GUARDRAILS,
    },
  };
}

describe("automation store", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-automations-"));
    process.env.ARGUS_HOME = home;
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
  });

  it("reads back what it wrote", () => {
    const list = [automation(), automation({ id: "a2", name: "Other" })];
    saveAutomations(list);
    expect(loadAutomations()).toEqual(list);
  });

  it("returns nothing when the files do not exist", () => {
    expect(loadAutomations()).toEqual([]);
    expect(loadAutomationRuns()).toEqual([]);
  });

  it("backs the file up and starts fresh on a schema mismatch", () => {
    const file = path.join(home, "automations.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 99, automations: [automation()] }),
    );

    expect(loadAutomations()).toEqual([]);
    expect(fs.existsSync(`${file}.bak`)).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("does not back up unparseable JSON — that is a corrupt write, not a migration", () => {
    const file = path.join(home, "automations.json");
    fs.writeFileSync(file, "{ not json");

    expect(loadAutomations()).toEqual([]);
    expect(fs.existsSync(`${file}.bak`)).toBe(false);
  });

  it("keeps only the newest runs per automation", () => {
    const many = Array.from({ length: MAX_RUNS_PER_AUTOMATION + 10 }, (_, i) =>
      run(`r${i}`, i),
    );
    const other = [run("o1", 0, "a2")];

    const retained = saveAutomationRuns([...many, ...other]);

    const forA1 = retained.filter((r) => r.automation_id === "a1");
    expect(forA1).toHaveLength(MAX_RUNS_PER_AUTOMATION);
    expect(forA1.map((r) => r.id)).not.toContain("r0");
    expect(forA1.map((r) => r.id)).toContain(`r${MAX_RUNS_PER_AUTOMATION + 9}`);
    // The cap is per automation, so a quiet one keeps its single run.
    expect(retained.filter((r) => r.automation_id === "a2")).toHaveLength(1);
    expect(loadAutomationRuns()).toEqual(retained);
  });

  it("caps every ad-hoc run against one bucket, not its own synthetic id", () => {
    // Each quick run invents an automation id, so per-id bucketing would keep
    // all of them forever.
    const many = Array.from({ length: MAX_RUNS_PER_AUTOMATION + 10 }, (_, i) =>
      scratchRun(`s${i}`, i),
    );

    const retained = saveAutomationRuns(many);

    expect(retained).toHaveLength(MAX_RUNS_PER_AUTOMATION);
    expect(retained.map((r) => r.id)).not.toContain("s0");
    expect(retained.map((r) => r.id)).toContain(
      `s${MAX_RUNS_PER_AUTOMATION + 9}`,
    );
  });
});
