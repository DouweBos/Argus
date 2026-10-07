import type { Session } from "../../session/models";
import type { AgentSession } from "../models";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitHostEvent, resetHostEventSinks } from "@argus/host/bus";
import { appState } from "../../../state";
import { enqueueMessage, listQueue } from "../messageQueue";

const sent = vi.hoisted(() => [] as { agentId: string; text: string }[]);
const restored = vi.hoisted(
  () => [] as { keepTurnNumber: number; sourceClaudeSessionId: string }[],
);
const checkpointsRestored = vi.hoisted(() => [] as string[]);

vi.mock("../agentService", () => ({
  sendAgentMessage: (agentId: string, text: string) => {
    sent.push({ agentId, text });
  },
  restoreAgentAtTurn: async (args: {
    keepTurnNumber: number;
    sourceClaudeSessionId: string;
  }) => {
    restored.push(args);

    return { claude_session_id: "cli-2" };
  },
}));
vi.mock("../chatHistory", () => ({ saveConversation: () => undefined }));
vi.mock("../checkpoints", () => ({
  createCheckpoint: async () => ({ id: "cp1" }),
  restoreCheckpoint: async (_session: string, id: string) => {
    checkpointsRestored.push(id);
  },
}));
vi.mock("../../llm/titleGenerator", () => ({
  generateChatTitle: async () => "A title",
}));
vi.mock("../../notifications/osNotification", () => ({
  showAgentNotification: () => false,
}));

const { startHostConversations, stopHostConversations } =
  await import("./hostDriver");
const actions = await import("./actions");
const { liveConversation, resetLive } = await import("./live");

const AGENT = "agent-1";

function addAgent(id = AGENT, status = "idle"): void {
  appState.sessions.set("s1", {
    id: "s1",
    repo_root: "/repo",
    branch: "b",
    description: "",
  } as unknown as Session);
  appState.agents.set(id, {
    agentId: id,
    sessionId: "s1",
    parentAgentId: null,
    runner: { id: "claude-code" },
    status,
    inflightPrompts: 0,
  } as unknown as AgentSession);
  emitHostEvent("agent:started", {
    agent_id: id,
    session_id: "s1",
    status,
    parent_agent_id: null,
    created_at: 0,
    model: null,
    runner_id: "claude-code",
  });
}

function line(event: unknown, id = AGENT): void {
  emitHostEvent(`agent:event:${id}`, JSON.stringify(event));
}

function reply(text: string, tool?: { name: string; input: unknown }): unknown {
  return {
    type: "assistant",
    message: {
      content: [
        { type: "text", text },
        ...(tool ? [{ type: "tool_use", id: `t-${text}`, ...tool }] : []),
      ],
      model: "opus",
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  };
}

function texts(id = AGENT): string[] {
  return (liveConversation(id)?.messages ?? []).map(
    (m) => `${m.role}: ${m.textBlocks.join("")}`,
  );
}

/** A chat of two turns, each user message with its checkpoint. */
async function twoTurns(): Promise<string[]> {
  addAgent();
  line({
    type: "system",
    subtype: "init",
    model: "opus",
    session_id: "cli-1",
    tools: [],
  });
  await actions.submitAgentMessage(AGENT, { text: "first" });
  line(
    reply("edited", {
      name: "Write",
      input: { file_path: "a.ts", content: "x" },
    }),
  );
  emitHostEvent(`agent:status:${AGENT}`, "idle");
  await actions.submitAgentMessage(AGENT, { text: "second" });
  line(reply("done"));
  emitHostEvent(`agent:status:${AGENT}`, "idle");

  return liveConversation(AGENT)!.messages.map((m) => m.id);
}

describe("conversation actions", () => {
  beforeEach(() => {
    resetHostEventSinks();
    startHostConversations();
  });

  afterEach(() => {
    stopHostConversations();
    resetLive();
    resetHostEventSinks();
    appState.agents.clear();
    appState.sessions.clear();
    appState.agentQueues.clear();
    sent.length = 0;
    restored.length = 0;
    checkpointsRestored.length = 0;
  });

  it("sends with a checkpoint and a bubble, and queues behind a turn", async () => {
    addAgent();

    await expect(
      actions.submitAgentMessage(AGENT, {
        text: "with preamble",
        displayText: "hello",
      }),
    ).resolves.toEqual({ queued: false });
    expect(sent).toEqual([{ agentId: AGENT, text: "with preamble" }]);
    expect(texts()).toEqual(["user: hello"]);
    expect(liveConversation(AGENT)?.messages[0]?.checkpointId).toBe("cp1");

    // Still in flight: the next one waits its turn.
    await expect(
      actions.submitAgentMessage(AGENT, { text: "next" }),
    ).resolves.toEqual({
      queued: true,
    });
    expect(listQueue(AGENT).map((q) => q.text)).toEqual(["next"]);
  });

  it("rewinds to a message, dropping the queue, and resends an edit", async () => {
    const ids = await twoTurns();
    // Queued behind a turn that is still running.
    appState.agents.get(AGENT)!.status = "running";
    enqueueMessage(AGENT, { text: "stale" });

    const result = await actions.rewindAgent(AGENT, ids[2]!, {
      resend: { text: "second, edited" },
    });

    expect(result).toEqual({
      claude_session_id: "cli-2",
      restoredPrompt: "second",
    });
    expect(restored).toEqual([
      expect.objectContaining({
        keepTurnNumber: 1,
        sourceClaudeSessionId: "cli-1",
      }),
    ]);
    expect(texts()).toEqual([
      "user: first",
      "assistant: edited",
      "user: second, edited",
    ]);
    expect(liveConversation(AGENT)?.sessionId).toBe("cli-2");
    expect(listQueue(AGENT)).toEqual([]);
    expect(sent.at(-1)?.text).toBe("second, edited");
  });

  it("restores the worktree to the message's checkpoint", async () => {
    const ids = await twoTurns();

    await actions.rewindAgent(AGENT, ids[2]!, { restoreFiles: true });

    expect(checkpointsRestored).toEqual(["cp1"]);
    expect(texts()).toEqual(["user: first", "assistant: edited"]);
  });

  it("forks from the whole history, whatever a viewer has loaded", async () => {
    const ids = await twoTurns();

    const point = actions.agentForkPoint(AGENT, ids[1]!);

    expect(point).toMatchObject({
      claudeSessionId: "cli-1",
      turnNumber: 1,
      replayOps: [{ type: "write", filePath: "a.ts", content: "x" }],
    });

    addAgent("fork");
    actions.seedForkedConversation(
      "fork",
      { agentId: AGENT, throughMessageId: ids[1]! },
      "cli-fork",
    );

    expect(texts("fork")).toEqual(["user: first", "assistant: edited"]);
    expect(liveConversation("fork")).toMatchObject({
      resuming: true,
      sessionId: "cli-fork",
    });
  });

  it("renames, dismisses lists and clears", async () => {
    await twoTurns();

    actions.setConversationTitle(AGENT, "Renamed");
    actions.dismissConversationList(AGENT, "todos");
    expect(liveConversation(AGENT)).toMatchObject({
      title: "Renamed",
      todos: null,
    });

    actions.clearConversation(AGENT);
    expect(texts()).toEqual([]);
  });
});
