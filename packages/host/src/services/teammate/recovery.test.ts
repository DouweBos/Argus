import type { AgentSession } from "../agent/models";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../../state";

vi.mock("../agent/agentService", () => ({
  startAgent: vi.fn(async (sessionId: string, ...rest: unknown[]) => {
    const agentId = rest[7] as string;
    appState.agents.set(agentId, { agentId, sessionId } as AgentSession);

    return { agent_id: agentId, session_id: sessionId, status: "idle" };
  }),
  stopAgent: vi.fn(),
}));
const submitted: { agentId: string; text: string }[] = [];
vi.mock("../agent/conversation/actions", () => ({
  submitAgentMessage: vi.fn(async (agentId: string, m: { text: string }) => {
    submitted.push({ agentId, text: m.text });

    return { queued: false };
  }),
}));
vi.mock("../llm/registry", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRunnerById: () => ({ latestTranscriptRef: async () => null }),
}));
vi.mock("../mcp/projects", () => ({ ensureRepoRegistered: vi.fn() }));
const capture = vi.fn();
vi.mock("../telemetry/telemetry", () => ({
  capture: (...args: unknown[]) => capture(...args),
}));

const { resetAutomationCache } = await import("../automation/manager");
const { createTeammate } = await import("./manager");
const { resetTeammateCache } = await import("./registry");
const { listThreads, openThread, resetThreadCache, threadRecord } =
  await import("./threads");
const { resetThreadRecovery, resumeThread, stopThreadRecovery } =
  await import("./recovery");
const { noteThreadMessage, noteThreadTurn } = await import("./threadSessions");
const { MAX_AUTO_RESUMES, resetAutoResume, resumeInterruptedThreads } =
  await import("./autoResume");

let home: string;
let previousHome: string | undefined;

describe("teammate thread failures", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-recovery-"));
    process.env.ARGUS_HOME = home;
    resetAutomationCache();
    resetTeammateCache();
    resetThreadCache();
    resetThreadRecovery();
    resetAutoResume();
    appState.agents.clear();
    appState.sessions.clear();
    submitted.length = 0;
    capture.mockClear();
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
  });

  async function started() {
    const teammate = createTeammate({ name: "Fixer" });
    const opened = await openThread(teammate.id);
    noteThreadMessage(opened.session_id, "why is main red?");

    return { teammate, opened };
  }

  it("keeps why a turn failed on the thread, and clears it on the next turn", async () => {
    const { teammate, opened } = await started();
    noteThreadTurn(opened.session_id, {
      kind: "result",
      failed: true,
      text: "Claude AI usage limit reached",
      resetsAt: 5_000,
    });

    expect(listThreads(teammate.id)[0]?.failure).toMatchObject({
      kind: "limit",
      resets_at: 5_000,
    });
    expect(listThreads(teammate.id)[0]).not.toHaveProperty("inflight_since");
    expect(capture).toHaveBeenCalledWith("teammate_thread_failed", {
      kind: "limit",
    });

    noteThreadMessage(opened.session_id, "try again");
    expect(listThreads(teammate.id)[0]?.failure).toBeNull();
  });

  it("calls an exit mid-turn a crash, but not a stop or a shutdown", async () => {
    const { teammate, opened } = await started();
    noteThreadTurn(opened.session_id, {
      kind: "exit",
      code: 1,
      intentional: true,
    });
    expect(listThreads(teammate.id)[0]?.failure ?? null).toBeNull();

    noteThreadMessage(opened.session_id, "again");
    stopThreadRecovery();
    noteThreadTurn(opened.session_id, {
      kind: "exit",
      code: 143,
      intentional: false,
    });
    expect(threadRecord(opened.thread.id)?.inflight_since).toBeTypeOf("number");
    expect(listThreads(teammate.id)[0]?.failure ?? null).toBeNull();

    resetThreadRecovery();
    noteThreadTurn(opened.session_id, {
      kind: "exit",
      code: 143,
      intentional: false,
    });
    expect(listThreads(teammate.id)[0]?.failure).toMatchObject({
      kind: "crashed",
    });
  });

  it("ignores an exit while the thread is idle", async () => {
    const { teammate, opened } = await started();
    noteThreadTurn(opened.session_id, {
      kind: "result",
      failed: false,
      text: "done",
      resetsAt: null,
    });
    noteThreadTurn(opened.session_id, {
      kind: "exit",
      code: 1,
      intentional: false,
    });

    expect(listThreads(teammate.id)[0]?.failure ?? null).toBeNull();
  });

  it("resumes a stopped thread with a continue", async () => {
    const { opened } = await started();
    noteThreadTurn(opened.session_id, {
      kind: "result",
      failed: true,
      text: "boom",
      resetsAt: null,
    });
    appState.agents.clear();

    const resumed = await resumeThread(opened.thread.id, "app");

    expect(resumed.agent_id).toBe(opened.agent_id);
    expect(submitted).toEqual([{ agentId: opened.agent_id, text: "continue" }]);
    expect(capture).toHaveBeenCalledWith("teammate_thread_resumed", {
      source: "app",
      kind: "error",
    });
    await expect(resumeThread("nope", "app")).rejects.toContain("not found");
  });

  describe("after a restart", () => {
    const resumes: string[] = [];
    const deps = {
      ready: async () => undefined,
      resume: async (threadId: string) => {
        resumes.push(threadId);
      },
      sleep: async () => undefined,
      now: () => 9,
    };

    /** A new host process: caches and the once-per-boot guard start over. */
    function reboot() {
      resetThreadCache();
      resetAutoResume();
      appState.agents.clear();
    }

    beforeEach(() => {
      resumes.length = 0;
    });

    it("resumes a thread left mid-turn once per boot", async () => {
      const { opened } = await started();
      reboot();

      await expect(resumeInterruptedThreads(deps)).resolves.toEqual({
        resumed: 1,
        failed: 0,
      });
      await expect(resumeInterruptedThreads(deps)).resolves.toEqual({
        resumed: 0,
        failed: 0,
      });
      expect(resumes).toEqual([opened.thread.id]);
      expect(threadRecord(opened.thread.id)?.auto_resumes).toBe(1);
    });

    it("gives up with a reason once a turn keeps taking the host down", async () => {
      const { teammate } = await started();
      for (let boot = 0; boot < MAX_AUTO_RESUMES; boot++) {
        reboot();
        await resumeInterruptedThreads(deps);
      }
      reboot();

      await expect(resumeInterruptedThreads(deps)).resolves.toEqual({
        resumed: 0,
        failed: 1,
      });
      expect(resumes).toHaveLength(MAX_AUTO_RESUMES);
      expect(listThreads(teammate.id)[0]?.failure).toMatchObject({
        kind: "interrupted",
        reason: "Interrupted by a restart.",
      });
      reboot();
      expect((await resumeInterruptedThreads(deps)).failed).toBe(0);
    });

    it("starts the count over once a turn gets through", async () => {
      const { opened } = await started();
      reboot();
      await resumeInterruptedThreads(deps);
      noteThreadTurn(opened.session_id, {
        kind: "result",
        failed: false,
        text: "done",
        resetsAt: null,
      });

      expect(threadRecord(opened.thread.id)?.auto_resumes).toBe(0);
      expect(threadRecord(opened.thread.id)?.inflight_since).toBeNull();
    });
  });
});
