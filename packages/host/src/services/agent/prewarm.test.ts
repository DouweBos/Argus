import type { AgentSession } from "./models";
import type { Session } from "../session/models";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitHostEvent, resetHostEventSinks } from "@argus/host/bus";
import { appState } from "../../state";

const saved = vi.hoisted(() => [] as { agentId: string; sessionId: string }[]);
vi.mock("./chatHistory", () => ({
  saveConversation: (
    _repo: string,
    conv: { agentId: string; sessionId: string },
  ) => {
    saved.push(conv);
  },
}));
vi.mock("./checkpoints", () => ({
  createCheckpoint: async () => ({ id: "cp1" }),
}));
vi.mock("../llm/titleGenerator", () => ({
  generateChatTitle: async () => null,
}));

const { discardPrewarmAgent } = await import("./agentService");
const { startHostConversations, stopHostConversations } =
  await import("./conversation/hostDriver");
const { submitAgentMessage } = await import("./conversation/actions");

const kill = vi.fn(async () => undefined);

function addWarmAgent(): AgentSession {
  appState.sessions.set("s1", {
    id: "s1",
    repo_root: "/repo",
    branch: "main",
    description: "",
  } as unknown as Session);
  const agent = {
    agentId: "a1",
    sessionId: "s1",
    parentAgentId: null,
    runner: { id: "claude-code" },
    status: "idle",
    prewarmed: true,
    model: null,
    createdAt: 0,
    inflightPrompts: 0,
    handle: {
      send: vi.fn(),
      kill,
      cleanup: vi.fn(),
      initializeResponse: () => null,
    },
  } as unknown as AgentSession;
  appState.agents.set("a1", agent);

  return agent;
}

function line(event: unknown): void {
  emitHostEvent("agent:event:a1", JSON.stringify(event));
}

describe("a window's warm agent another client sends to", () => {
  beforeEach(() => {
    resetHostEventSinks();
    startHostConversations();
  });

  afterEach(() => {
    stopHostConversations();
    resetHostEventSinks();
    appState.agents.clear();
    appState.sessions.clear();
    saved.length = 0;
    kill.mockClear();
  });

  it("lands in chat history when it is stopped mid-turn", async () => {
    addWarmAgent();
    await submitAgentMessage("a1", { text: "look into the diffing" });
    line({
      type: "system",
      subtype: "init",
      model: "opus",
      session_id: "cli-1",
      tools: [],
    });
    line({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "t1", name: "Agent", input: {} }],
        model: "opus",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    emitHostEvent("agent:status:a1", "stopped");

    expect(saved.at(-1)).toMatchObject({ agentId: "a1", sessionId: "cli-1" });
  });

  it("isn't discarded by the window that warmed it", async () => {
    const agent = addWarmAgent();
    await submitAgentMessage("a1", { text: "hi" });
    await discardPrewarmAgent("a1");

    expect(kill).not.toHaveBeenCalled();
    expect(agent.prewarmed).toBe(false);
  });
});
