import type { AgentSession } from "../agent/models";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appState } from "../../state";

const startAgent = vi.fn(async (sessionId: string, ...rest: unknown[]) => {
  const agentId = rest[7] as string;
  appState.agents.set(agentId, { agentId, sessionId } as AgentSession);

  return {
    agent_id: agentId,
    session_id: sessionId,
    status: "idle",
    parent_agent_id: null,
    created_at: 0,
    model: null,
  };
});
const stopAgent = vi.fn(async (agentId: string) => {
  appState.agents.delete(agentId);
});
vi.mock("../agent/agentService", () => ({
  startAgent: (...args: unknown[]) =>
    startAgent(...(args as [string, ...unknown[]])),
  stopAgent: (agentId: string) => stopAgent(agentId),
}));

const transcriptRef = vi.fn(
  async (_cwd: string): Promise<string | null> => null,
);
vi.mock("../llm/registry", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getRunnerById: () => ({ latestTranscriptRef: transcriptRef }),
}));
vi.mock("../mcp/projects", () => ({ ensureRepoRegistered: vi.fn() }));

const { resetAutomationCache } = await import("../automation/manager");
const { automationSessionAutonomy, automationDisallowedTools } =
  await import("../automation/shellGuard");
const { memoryOwnerForAgent } = await import("../mcp/automationCaller");
const { automationWorkBlock } = await import("../mcp/automationGuards");
const { createTeammate, listTeammates } = await import("./manager");
const { resetTeammateCache } = await import("./registry");
const {
  archiveThread,
  deleteTeammateWithThreads,
  listThreads,
  openThread,
  resetThreadCache,
} = await import("./threads");
const { noteThreadMessage, teammateThreadForSession } =
  await import("./threadSessions");

let home: string;
let previousHome: string | undefined;

describe("teammate conversations", () => {
  beforeEach(() => {
    previousHome = process.env.ARGUS_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "argus-threads-"));
    process.env.ARGUS_HOME = home;
    resetAutomationCache();
    resetTeammateCache();
    resetThreadCache();
    appState.agents.clear();
    appState.sessions.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.ARGUS_HOME;
    } else {
      process.env.ARGUS_HOME = previousHome;
    }
    fs.rmSync(home, { force: true, recursive: true });
  });

  it("opens the newest thread again rather than a new one", async () => {
    const teammate = createTeammate({ name: "Fixer" });
    const first = await openThread(teammate.id);
    const again = await openThread(teammate.id);
    const fresh = await openThread(teammate.id, { fresh: true });

    expect(again.thread.id).toBe(first.thread.id);
    expect(fresh.thread.id).not.toBe(first.thread.id);
    expect(listThreads(teammate.id)).toHaveLength(2);
    expect(startAgent).toHaveBeenCalledTimes(2);
  });

  it("starts the agent with the teammate's soul, in plan mode at propose", async () => {
    const teammate = createTeammate({
      name: "Fixer",
      soul: "You fix CI and nothing else.",
      autonomy: "propose",
    });
    await openThread(teammate.id);

    const [, , mode, resume, prompt] = startAgent.mock.calls[0];
    expect(mode).toBe("plan");
    expect(resume).toBeUndefined();
    expect(prompt).toContain("You fix CI and nothing else.");
    expect(prompt).toContain("@fixer");
  });

  it("resumes the thread's transcript after a restart under the same agent id", async () => {
    const teammate = createTeammate({ name: "Fixer" });
    const opened = await openThread(teammate.id);
    appState.agents.clear();
    appState.sessions.clear();
    transcriptRef.mockResolvedValueOnce("transcript-1");

    const again = await openThread(teammate.id);

    expect(again.agent_id).toBe(opened.agent_id);
    expect(startAgent.mock.calls[1][3]).toBe("transcript-1");
    expect(transcriptRef.mock.calls[0][0]).toContain(opened.thread.id);
  });

  it("holds the conversation to the teammate's ladder", async () => {
    const teammate = createTeammate({ name: "Fixer", autonomy: "propose" });
    const { agent_id, session_id } = await openThread(teammate.id);

    expect(automationSessionAutonomy(session_id)?.autonomy).toBe("propose");
    expect(automationDisallowedTools(session_id)).toContain("Edit");
    expect(automationWorkBlock(agent_id, null)).toContain("Refused");
    expect(memoryOwnerForAgent(agent_id)).toEqual({
      kind: "teammate",
      id: teammate.id,
    });
  });

  it("titles a thread after the first message", async () => {
    const teammate = createTeammate({ name: "Fixer" });
    const { session_id } = await openThread(teammate.id);

    noteThreadMessage(session_id, "  Why is main red\nagain?  ");
    noteThreadMessage(session_id, "second message");

    expect(listThreads(teammate.id)[0].title).toBe("Why is main red again?");
  });

  it("stops an archived thread's agent and forgets its session", async () => {
    const teammate = createTeammate({ name: "Fixer" });
    const { thread, session_id } = await openThread(teammate.id);

    await archiveThread(thread.id);

    expect(stopAgent).toHaveBeenCalledWith(thread.agent_id);
    expect(appState.sessions.has(session_id)).toBe(false);
    expect(teammateThreadForSession(session_id)).toBeNull();
    expect(listThreads(teammate.id)).toEqual([]);
  });

  it("deletes a teammate with its conversations", async () => {
    const teammate = createTeammate({ name: "Fixer" });
    await openThread(teammate.id);

    await deleteTeammateWithThreads(teammate.id, false);

    expect(listTeammates()).toEqual([]);
    expect(appState.agents.size).toBe(0);
  });
});
