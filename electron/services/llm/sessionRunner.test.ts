import type { LlmRunner } from "./runners/types";
import type { AgentSession } from "../agent/models";
import type { Session } from "../session/models";
import { beforeEach, describe, expect, it, vi } from "vitest";

const respawnAgent = vi.fn(async (_id: string) => {});
const stopAgent = vi.fn(async (_id: string) => {});

vi.mock("../agent/agentService", () => ({
  respawnAgent: (id: string) => respawnAgent(id),
  stopAgent: (id: string) => stopAgent(id),
}));
vi.mock("../../broadcast", () => ({ broadcastToRenderers: () => {} }));
vi.mock("../session/git", () => ({ worktreesRoot: () => "/worktrees" }));
vi.mock("../session/metadata", () => ({
  loadMetadata: () => new Map(),
  saveMetadata: () => {},
}));

const { appState } = await import("../../state");
const { registerRunner } = await import("./registry");
const { setSessionRunner } = await import("./sessionRunner");

function fakeRunner(id: string, defaultModel: string | null): LlmRunner {
  return {
    id,
    displayName: id,
    isCustom: true,
    capabilities: () => ({
      supportsMcp: true,
      supportsTranscriptFork: true,
      supportsSetModel: true,
      supportsSetPermissionMode: true,
      supportsSetEffort: true,
      supportsInterrupt: true,
    }),
    defaultModel: () => defaultModel,
    preflight: async () => ({ ok: true, binPath: "/usr/bin/fake" }),
    spawn: async () => ({}) as never,
    oneShot: async () => null,
  };
}

function addSession(): Session {
  const session = {
    id: "s1",
    kind: "worktree",
    branch: "feature",
    display_name: "s1",
    description: "",
    path: "/worktrees/feature",
    repo_root: "/repo",
    status: "ready",
    env_index: 0,
    runner_id: "claude-code",
    model: "claude-opus-5",
  } as Session;
  appState.sessions.set(session.id, session);

  return session;
}

function addAgent(agentId: string, over: Partial<AgentSession> = {}): void {
  appState.agents.set(agentId, {
    agentId,
    sessionId: "s1",
    turnsCompleted: 0,
    inflightPrompts: 0,
    prewarmed: false,
    ...over,
  } as AgentSession);
}

describe("setSessionRunner", () => {
  beforeEach(() => {
    appState.sessions.clear();
    appState.agents.clear();
    respawnAgent.mockClear();
    stopAgent.mockClear();
    registerRunner(fakeRunner("custom:apex", "callstack/Apex"));
  });

  it("re-binds the session and resets the model to the new runner's default", async () => {
    const session = addSession();

    await setSessionRunner("s1", "custom:apex");

    expect(session.runner_id).toBe("custom:apex");
    expect(session.model).toBe("callstack/Apex");
  });

  it("restarts message-free agents and drops prewarms", async () => {
    addSession();
    addAgent("live");
    addAgent("warm", { prewarmed: true });

    await setSessionRunner("s1", "custom:apex");

    expect(respawnAgent).toHaveBeenCalledWith("live");
    expect(stopAgent).toHaveBeenCalledWith("warm");
  });

  it("refuses once the agent has started working", async () => {
    const session = addSession();
    addAgent("live", { turnsCompleted: 1 });

    await expect(setSessionRunner("s1", "custom:apex")).rejects.toContain(
      "fixed once the agent has started working",
    );
    expect(session.runner_id).toBe("claude-code");
  });

  it("rejects an unregistered runner", async () => {
    addSession();

    await expect(setSessionRunner("s1", "custom:nope")).rejects.toContain(
      "Unknown runner",
    );
  });
});
