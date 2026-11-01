import type { AgentSession } from "../models";
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const emitted: [string, unknown][] = [];
vi.mock("@argus/host/bus", () => ({
  emitHostEvent: (channel: string, payload: unknown) => {
    emitted.push([channel, payload]);
  },
}));
const captured: [string, unknown][] = [];
vi.mock("../../telemetry/telemetry", () => ({
  capture: (name: string, props: unknown) => captured.push([name, props]),
}));
const history: { entries: object[] } = { entries: [] };
vi.mock("../chatHistory", () => ({
  loadHistoryIndex: () => history.entries,
}));
const conversations = new Map<string, { sessionId?: string; title?: string }>();
vi.mock("../conversation/live", () => ({
  liveConversation: (id: string) => conversations.get(id) ?? null,
}));

const { appState } = await import("../../../state");
const store = await import("./store");
const {
  adoptPinOnResume,
  dropPinsForSession,
  pinForHistory,
  refreshPin,
  setAgentPinned,
  setHistoryPinned,
} = await import("./pins");

function addAgent(id = "a1"): AgentSession {
  const agent = {
    agentId: id,
    sessionId: "s1",
    status: "idle",
    model: "claude-haiku",
    permissionMode: "plan",
    effort: "low",
    runner: { id: "claude-code" },
  } as unknown as AgentSession;
  appState.agents.set(id, agent);

  return agent;
}

const pinFile = () => path.join(process.env.ARGUS_HOME!, "pinned-chats.json");

function reset(): void {
  fs.rmSync(pinFile(), { force: true });
  store.resetPinCache();
  appState.agents.clear();
  appState.sessions.clear();
  appState.sessions.set("s1", { id: "s1", repo_root: "/repo" } as never);
  conversations.clear();
  emitted.length = 0;
  captured.length = 0;
  history.entries = [];
}

describe("pinning a live agent", () => {
  beforeEach(reset);

  it("records its conversation and settings, and survives a restart", () => {
    addAgent();
    conversations.set("a1", { sessionId: "claude-1", title: "Fix it" });

    expect(setAgentPinned("a1", true, "ipc")).toEqual({ pinned: true });
    store.resetPinCache();

    expect(store.getPin("a1")).toMatchObject({
      agentId: "a1",
      sessionId: "s1",
      repoRoot: "/repo",
      runnerSessionId: "claude-1",
      runnerId: "claude-code",
      model: "claude-haiku",
      permissionMode: "plan",
      effort: "low",
      title: "Fix it",
    });
    expect(emitted).toContainEqual(["agent:pinned:a1", true]);
    expect(captured).toContainEqual([
      "agent_pinned",
      { action: "pin", target: "agent", via: "ipc" },
    ]);
  });

  it("follows the agent's latest conversation and settings", () => {
    const agent = addAgent();
    setAgentPinned("a1", true, "remote");
    conversations.set("a1", { sessionId: "claude-2" });
    agent.model = "claude-opus";
    refreshPin(agent);
    store.resetPinCache();

    expect(store.getPin("a1")).toMatchObject({
      runnerSessionId: "claude-2",
      model: "claude-opus",
    });
  });

  it("unpins without needing the agent, and refuses to pin one that's gone", () => {
    addAgent();
    setAgentPinned("a1", true, "ipc");
    appState.agents.clear();

    expect(setAgentPinned("a1", false, "ipc")).toEqual({ pinned: false });
    expect(store.isPinned("a1")).toBe(false);
    expect(() => setAgentPinned("a1", true, "ipc")).toThrow(/No agent/);
  });

  it("hands the pin to an agent that resumed the conversation by hand", () => {
    addAgent();
    conversations.set("a1", { sessionId: "claude-1" });
    setAgentPinned("a1", true, "ipc");
    appState.agents.delete("a1");

    adoptPinOnResume("a2", "claude-1");

    expect(store.isPinned("a1")).toBe(false);
    expect(store.getPin("a2")?.runnerSessionId).toBe("claude-1");
  });

  it("leaves the pin alone while its own agent is still live", () => {
    addAgent();
    conversations.set("a1", { sessionId: "claude-1" });
    setAgentPinned("a1", true, "ipc");

    adoptPinOnResume("a2", "claude-1");

    expect(store.isPinned("a1")).toBe(true);
    expect(store.isPinned("a2")).toBe(false);
  });

  it("drops a deleted session's pins", () => {
    addAgent();
    setAgentPinned("a1", true, "ipc");
    dropPinsForSession("s1");

    expect(store.listPins()).toEqual([]);
  });
});

describe("pinning a saved chat", () => {
  beforeEach(reset);

  const entry = {
    id: "h1",
    sessionId: "claude-9",
    agentId: "old-agent",
    argusSessionId: "s1",
    title: "Old chat",
    model: "claude-haiku",
    runnerId: "claude-code",
    permissionMode: "auto",
  };

  it("records it under the agent id it last ran as", () => {
    history.entries = [entry];

    setHistoryPinned("/repo", "h1", true, "remote");

    expect(store.getPin("old-agent")).toMatchObject({
      sessionId: "s1",
      runnerSessionId: "claude-9",
      title: "Old chat",
    });
    expect(pinForHistory(entry)?.agentId).toBe("old-agent");
    setHistoryPinned("/repo", "h1", false, "remote");
    expect(pinForHistory(entry)).toBeUndefined();
  });

  it("refuses a chat whose session is gone", () => {
    history.entries = [{ ...entry, argusSessionId: "gone" }];

    expect(() => setHistoryPinned("/repo", "h1", true, "ipc")).toThrow(
      /no longer exists/,
    );
  });
});
