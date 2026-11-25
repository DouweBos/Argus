import type { Session } from "../session/models";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const latestTranscriptRef = vi.fn<(cwd: string) => Promise<string | null>>();
const forkTranscript = vi.fn(async () => ({ resumeRef: "forked-ref" }));
let runner: Record<string, unknown> | undefined;
vi.mock("../llm/registry", () => ({ getRunnerById: () => runner }));
const telemetry = vi.fn();
vi.mock("../telemetry/telemetry", () => ({ capture: telemetry }));

const { continuationFor } = await import("./continuation");
const { createAutomation, createRun, resetAutomationCache, updateRun } =
  await import("./manager");
const { automationRunDir } = await import("./paths");

let home: string;
let previousHome: string | undefined;

function session(runId: string, automationId: string): Session {
  return {
    id: `s-${runId}`,
    path: automationRunDir(automationId, runId),
    runner_id: "claude-code",
  } as Session;
}

function automation(continueConversation = true) {
  return createAutomation({
    name: "Keeps talking",
    playbook: "Carry on.",
    trigger: { kind: "manual" },
    continue_conversation: continueConversation,
  });
}

/** A run that got as far as an agent. */
function finishedRun(automationId: string) {
  const run = createRun(automationId, "succeeded", "manual");
  updateRun(run.id, { host_session_id: `s-${run.id}` });

  return run;
}

describe("continuing the previous run's conversation", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-continue-"));
    process.env.ARGUS_HOME = home;
    resetAutomationCache();
    runner = { latestTranscriptRef, forkTranscript };
    latestTranscriptRef.mockReset();
    forkTranscript.mockClear();
    telemetry.mockClear();
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
  });

  it("forks the previous run's transcript into this run", async () => {
    const a = automation();
    const previous = finishedRun(a.id);
    const run = createRun(a.id, "running", "manual");
    latestTranscriptRef.mockResolvedValue("previous-ref");

    const result = await continuationFor(a, run.id, session(run.id, a.id));

    expect(result).toEqual({
      resumeRef: "forked-ref",
      conversation: "continued",
    });
    expect(latestTranscriptRef).toHaveBeenCalledWith(
      automationRunDir(a.id, previous.id),
    );
    expect(forkTranscript).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRef: "previous-ref",
        sourceCwd: automationRunDir(a.id, previous.id),
        destCwd: automationRunDir(a.id, run.id),
      }),
    );
    expect(telemetry).toHaveBeenCalledWith(
      "automation_conversation_continued",
      { outcome: "continued" },
    );
  });

  it("falls back to a fresh run when the previous conversation is gone", async () => {
    const a = automation();
    finishedRun(a.id);
    const run = createRun(a.id, "running", "manual");
    latestTranscriptRef.mockResolvedValue(null);

    const result = await continuationFor(a, run.id, session(run.id, a.id));

    expect(result).toEqual({ resumeRef: undefined, conversation: "fell_back" });
    expect(forkTranscript).not.toHaveBeenCalled();
    expect(telemetry).toHaveBeenCalledWith(
      "automation_conversation_continued",
      { outcome: "fell_back" },
    );
  });

  it("falls back on a runner that can't fork a conversation", async () => {
    const a = automation();
    finishedRun(a.id);
    const run = createRun(a.id, "running", "manual");
    runner = { latestTranscriptRef };

    const result = await continuationFor(a, run.id, session(run.id, a.id));

    expect(result.conversation).toBe("fell_back");
  });

  it("skips past runs that never had an agent", async () => {
    const a = automation();
    const previous = finishedRun(a.id);
    createRun(a.id, "skipped", "manual", "Skipped — the precheck failed.");
    const run = createRun(a.id, "running", "manual");
    latestTranscriptRef.mockResolvedValue("previous-ref");

    await continuationFor(a, run.id, session(run.id, a.id));

    expect(latestTranscriptRef).toHaveBeenCalledWith(
      automationRunDir(a.id, previous.id),
    );
  });

  it("starts fresh, saying nothing, on the first run", async () => {
    const a = automation();
    const run = createRun(a.id, "running", "manual");

    const result = await continuationFor(a, run.id, session(run.id, a.id));

    expect(result).toEqual({ resumeRef: undefined, conversation: null });
    expect(telemetry).not.toHaveBeenCalledWith(
      "automation_conversation_continued",
      expect.anything(),
    );
  });

  it("does nothing when the option is off", async () => {
    const a = automation(false);
    finishedRun(a.id);
    const run = createRun(a.id, "running", "manual");

    const result = await continuationFor(a, run.id, session(run.id, a.id));

    expect(result.conversation).toBeNull();
    expect(latestTranscriptRef).not.toHaveBeenCalled();
  });
});
