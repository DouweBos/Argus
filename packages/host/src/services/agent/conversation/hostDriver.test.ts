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
const interrupted = vi.hoisted(() => [] as string[]);

vi.mock("../agentService", () => ({
  sendAgentMessage: (agentId: string, text: string) => {
    sent.push({ agentId, text });
  },
  interruptAgent: async (agentId: string) => {
    interrupted.push(agentId);
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

const { sendQueuedMessageNow, startHostConversations, stopHostConversations } =
  await import("./hostDriver");
const { readConversation, resetLive, stageConversation } =
  await import("./live");

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
    stopHostConversations();
    resetLive();
    resetHostEventSinks();
    appState.agents.clear();
    appState.sessions.clear();
    appState.agentQueues.clear();
    sent.length = 0;
    saved.length = 0;
    interrupted.length = 0;
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

  it("interrupts a busy agent to send a queued message ahead of the rest", async () => {
    addAgent("running");
    started();
    enqueueMessage(AGENT, { text: "first in line" });
    const urgent = enqueueMessage(AGENT, { text: "look at this instead" });

    await expect(sendQueuedMessageNow(AGENT, urgent.id)).resolves.toEqual({
      interrupted: true,
    });
    expect(interrupted).toEqual([AGENT]);
    expect(sent).toEqual([]);

    // The host marks the agent idle before it announces it.
    appState.agents.get(AGENT)!.status = "idle";
    emitHostEvent(`agent:status:${AGENT}`, "idle");
    await vi.advanceTimersByTimeAsync(100);

    expect(sent).toEqual([{ agentId: AGENT, text: "look at this instead" }]);
    expect(appState.agentQueues.get(AGENT)?.map((m) => m.text)).toEqual([
      "first in line",
    ]);
  });

  it("refuses to send a message that is no longer queued", async () => {
    addAgent("running");
    started();

    await expect(sendQueuedMessageNow(AGENT, "gone")).rejects.toMatch(
      /No queued message/,
    );
    expect(interrupted).toEqual([]);
  });

  it("saves chat history when the agent exits", async () => {
    addAgent();
    started();
    line(INIT);
    line(reply("Report written."));
    emitHostEvent(`agent:exit:${AGENT}`, 0);

    expect(saved.at(-1)?.messageCount).toBe(1);
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

  it("starts a resumed agent from its saved history and skips the replay", async () => {
    addAgent();
    stageConversation(AGENT, {
      messages: [
        {
          id: "old",
          role: "user",
          textBlocks: ["from last time"],
          toolCalls: [],
          timestamp: 1,
        },
      ],
      resuming: true,
      title: "Saved",
    });
    started();
    // The CLI replays its last turn on --resume; nothing new until a result.
    line(reply("replayed"));
    line({
      type: "result",
      subtype: "success",
      duration_ms: 1,
      total_cost_usd: 0,
    });
    line(reply("new"));
    await vi.advanceTimersByTimeAsync(20);

    expect(texts()).toEqual(["user: from last time", "assistant: new"]);
    expect(snapshot()?.title).toBe("Saved");
  });
});
