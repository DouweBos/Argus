import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetHostEventSinks } from "@argus/host/bus";
import { appState } from "../../state";

const startAgent = vi.fn(async () => {
  throw "no agents in this test";
});
vi.mock("../agent/agentService", () => ({
  sendAgentMessage: vi.fn(),
  startAgent,
  stopAgent: vi.fn(),
  waitForAgent: vi.fn(),
}));
vi.mock("../signals/registry", () => ({
  gatherSignals: vi.fn(async () => ({
    items: [],
    instructions: [],
    unavailable: [],
  })),
  screenWorkItems: vi.fn(async () => ({ items: [], withheld: 0 })),
  serializeWorkItems: vi.fn(() => "[]"),
}));
vi.mock("../mcp/projects", () => ({ ensureRepoRegistered: vi.fn() }));
const telemetry = vi.fn();
vi.mock("../telemetry/telemetry", () => ({ capture: telemetry }));

const { normalizePrecheckTimeout, runPrecheck } = await import("./precheck");
const { createAutomation, getAutomationRun, resetAutomationCache } =
  await import("./manager");
const { startAutomationRun } = await import("./runner");

let home: string;
let repoRoot: string;
let previousHome: string | undefined;

describe("precheck", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-precheck-"));
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "argus-precheck-repo-"));
    process.env.ARGUS_HOME = home;
    resetAutomationCache();
    resetHostEventSinks();
    appState.sessions.clear();
    appState.agents.clear();
    startAgent.mockClear();
    telemetry.mockClear();
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
    fs.rmSync(repoRoot, { force: true, recursive: true });
  });

  describe("runPrecheck", () => {
    it("passes on exit 0", async () => {
      await expect(runPrecheck("true", repoRoot, 5)).resolves.toEqual({
        outcome: "passed",
        reason: null,
      });
    });

    it("fails with the exit code and the last lines of output", async () => {
      const script = "for i in 1 2 3 4 5 6 7; do echo line $i; done; exit 3";
      const result = await runPrecheck(script, repoRoot, 5);

      expect(result.outcome).toBe("failed");
      expect(result.reason).toContain("exited with code 3");
      expect(result.reason).toContain("line 7");
      expect(result.reason).toContain("line 3");
      expect(result.reason).not.toContain("line 2");
    });

    it("runs in the directory it is given", async () => {
      fs.writeFileSync(path.join(repoRoot, "marker"), "");

      await expect(
        runPrecheck("test -f marker", repoRoot, 5),
      ).resolves.toMatchObject({ outcome: "passed" });
    });

    it("times out, and takes what the command started down with it", async () => {
      const started = Date.now();
      const result = await runPrecheck(
        "echo waiting; sleep 30 & wait",
        repoRoot,
        1,
      );

      expect(result.outcome).toBe("timed_out");
      expect(result.reason).toContain("within 1s");
      expect(result.reason).toContain("waiting");
      expect(Date.now() - started).toBeLessThan(5000);
    });

    it("clamps the timeout", () => {
      expect(normalizePrecheckTimeout(undefined)).toBe(60);
      expect(normalizePrecheckTimeout(-4)).toBe(60);
      expect(normalizePrecheckTimeout(0.4)).toBe(1);
      expect(normalizePrecheckTimeout(10_000)).toBe(1800);
    });
  });

  describe("an automation's precheck", () => {
    function automation(precheck: string) {
      return createAutomation({
        name: "Only when there is work",
        playbook: "Do the work.",
        trigger: { kind: "manual" },
        scope: { repo_roots: [repoRoot] },
        precheck_command: precheck,
        precheck_timeout_seconds: 5,
      });
    }

    it("skips the run with the reason when it fails", async () => {
      const run = startAutomationRun(
        automation("echo nothing new; exit 1").id,
        "manual",
      );

      await vi.waitFor(() =>
        expect(getAutomationRun(run.id)?.status).toBe("skipped"),
      );
      expect(getAutomationRun(run.id)?.error).toContain("nothing new");
      expect(startAgent).not.toHaveBeenCalled();
      expect(telemetry).toHaveBeenCalledWith("automation_precheck_ran", {
        outcome: "failed",
      });
    });

    it("lets the run go on when it passes", async () => {
      startAutomationRun(automation("exit 0").id, "manual");

      await vi.waitFor(() => expect(startAgent).toHaveBeenCalled());
      expect(telemetry).toHaveBeenCalledWith("automation_precheck_ran", {
        outcome: "passed",
      });
    });

    it("is not run, nor counted, when there is none", async () => {
      startAutomationRun(automation("").id, "manual");

      await vi.waitFor(() => expect(startAgent).toHaveBeenCalled());
      expect(telemetry).not.toHaveBeenCalledWith(
        "automation_precheck_ran",
        expect.anything(),
      );
    });
  });
});
