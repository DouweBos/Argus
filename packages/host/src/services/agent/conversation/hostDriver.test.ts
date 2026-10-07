import type { AgentConversation } from "./types";
import type { Session } from "../../session/models";
import type { AgentSession } from "../models";
import type { AgentTranscriptDelta } from "@argus/remote-protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addHostEventSink,
  emitHostEvent,
  resetHostEventSinks,
} from "@argus/host/bus";
import { appState } from "../../../state";
import { enqueueMessage } from "../messageQueue";

const sent = vi.hoisted(() => [] as { agentId: string; text: string }[]);
const saved = vi.hoisted(() => [] as { messageCount: number }[]);

vi.mock("../agentService", () => ({
  sendAgentMessage: (agentId: string, text: string) => {
    sent.push({ agentId, text });
  },
}));
vi.mock("../chatHistory", () => ({
  saveConversation: (_repo: string, conv: { messageCount: number }) => {
    saved.push(conv);
  },
}));
vi.mock("../checkpoints", () => ({
  createCheckpoint: async () => ({ id: "cp1" }),
}));
vi.mock("../../llm/titleGenerator", () => ({
  generateChatTitle: async () => "Fix the login",
}));
vi.mock("../../notifications/osNotification", () => ({
  showAgentNotification: () => false,
}));

const { claimConversations, resetHostConversations, startHostConversations } =
  await import("./hostDriver");
const { readConversation } = await import("./live");

const AGENT = "agent-1";

function addAgent(status = "idle"): void {
  appState.sessions.set("s1", {
    id: "s1",
    repo_root: "/repo",
    branch: "fix-login",
    description: "",
  } as unknown as Session);
  appState.agents.set(AGENT, {
    agentId: AGENT,
    sessionId: "s1",
    parentAgentId: null,
    runner: { id: "claude-code" },
    status,
  } as unknown as AgentSession);
}

function started(): void {
  emitHostEvent("agent:started", {
    agent_id: AGENT,
    session_id: "s1",
    status: "idle",
    parent_agent_id: null,
    created_at: 0,
    model: null,
    runner_id: "claude-code",
  });
}

function line(event: unknown): void {
  emitHostEvent(`agent:event:${AGENT}`, JSON.stringify(event));
}

function snapshot(): AgentConversation | null {
  return readConversation(AGENT);
}

function texts(): string[] {
  return (snapshot()?.messages ?? []).map(
    (m) => `${m.role}: ${m.textBlocks.join("")}`,
  );
}

const INIT = {
  type: "system",
  subtype: "init",
  model: "opus",
  session_id: "cli-1",
  tools: [],
};

function reply(text: string): unknown {
  return {
    type: "assistant",
    message: {
      content: [{ type: "text", text }],
      model: "opus",
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  };
}

describe("host conversation driver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetHostEventSinks();
    startHostConversations();
  });

  afterEach(() => {
    resetHostConversations();
    resetHostEventSinks();
    appState.agents.clear();
    appState.sessions.clear();
    appState.agentSnapshots.clear();
    appState.agentQueues.clear();
    sent.length = 0;
    saved.length = 0;
    vi.useRealTimers();
  });

  it("publishes the transcript a headless host serves the phone", async () => {
    addAgent();
    started();
    emitHostEvent(`agent:remote-message:${AGENT}`, {
      message: "fix the login",
      author: null,
    });
    line(INIT);
    line(reply("Done."));
    await vi.advanceTimersByTimeAsync(100);

    expect(texts()).toEqual(["user: fix the login", "assistant: Done."]);
    expect(snapshot()?.title).toBe("Fix the login");
  });

  it("sends a queued message once the turn ends and shows it", async () => {
    addAgent("running");
    started();
    enqueueMessage(AGENT, { text: "and the signup", author: "Sam" });
    emitHostEvent(`agent:status:${AGENT}`, "idle");
    await vi.advanceTimersByTimeAsync(100);

    expect(sent).toEqual([{ agentId: AGENT, text: "and the signup" }]);
    expect(texts()).toEqual(["user: and the signup"]);
    expect(snapshot()?.messages[0]?.author).toBe("Sam");
    expect(appState.agentQueues.get(AGENT)).toEqual([]);
  });

  it("saves chat history when the agent exits", async () => {
    addAgent();
    started();
    line(INIT);
    line(reply("Report written."));
    emitHostEvent(`agent:exit:${AGENT}`, 0);

    expect(saved.at(-1)?.messageCount).toBe(1);
  });

  it("stands down while a UI owns conversations, then picks up its snapshot", async () => {
    addAgent();
    const release = claimConversations();
    started();
    line(reply("from the host"));
    enqueueMessage(AGENT, { text: "queued" });
    await vi.advanceTimersByTimeAsync(600);

    expect(snapshot()).toBeNull();
    expect(sent).toEqual([]);

    // The UI's last word before it goes.
    appState.agentSnapshots.set(
      AGENT,
      JSON.stringify({
        messages: [
          {
            id: "m1",
            role: "user",
            textBlocks: ["from the UI"],
            toolCalls: [],
            timestamp: 1,
          },
        ],
      }),
    );
    release();
    line(reply("after"));
    await vi.advanceTimersByTimeAsync(100);

    expect(texts()).toEqual(["user: from the UI", "assistant: after"]);
  });

  it("follows the conversation with revisioned deltas", async () => {
    const deltas: AgentTranscriptDelta[] = [];
    addAgent();
    started();
    addHostEventSink((channel, args) => {
      if (channel === `agent:transcript:${AGENT}`) {
        deltas.push(args[0] as AgentTranscriptDelta);
      }
    });
    line(INIT);
    line(reply("one"));
    await vi.advanceTimersByTimeAsync(20);
    line(reply("two"));
    await vi.advanceTimersByTimeAsync(20);

    expect(deltas.map((d) => d.revision)).toEqual([1, 2]);
    expect(new Set(deltas.map((d) => d.epoch)).size).toBe(1);
    expect(deltas[0]?.ops.map((o) => o.op)).toEqual(["append"]);
    expect(deltas[0]?.meta?.sessionId).toBe("cli-1");
    expect(deltas[1]?.ops).toMatchObject([{ op: "append", index: 1 }]);
    expect(deltas[1]?.meta?.sessionId).toBeUndefined();
    expect(deltas[1]?.total).toBe(2);
  });

  it("serves the newest page, lined up with the deltas", async () => {
    const { livePage } = await import("./live");
    addAgent();
    started();
    line(INIT);
    for (let i = 0; i < 5; i++) {
      line(reply(`r${i}`));
    }
    // Pending, not yet emitted: the page sends it first.
    const page = livePage(AGENT, { limit: 2 });

    expect(page?.revision).toBe(1);
    expect(page?.start).toBe(3);
    expect(page?.total).toBe(5);
    expect(page?.messages.map((m) => m.textBlocks[0])).toEqual(["r3", "r4"]);
    expect(
      livePage(AGENT, { before: 3, limit: 2 })?.messages.map(
        (m) => m.textBlocks[0],
      ),
    ).toEqual(["r1", "r2"]);
  });
});
