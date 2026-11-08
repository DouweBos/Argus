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
const saved = vi.hoisted(
  () =>
    [] as {
      messageCount: number;
      permissionMode?: string;
      effort?: string;
    }[],
);
const interrupted = vi.hoisted(() => [] as string[]);
const followUps = vi.hoisted(() => ({
  asked: [] as string[],
  reply: ["Add the tests", "Commit it"] as string[] | null,
  enabled: true,
}));

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
vi.mock("../../llm/followUps", () => ({
  generateFollowUps: async (text: string) => {
    followUps.asked.push(text);

    return followUps.reply;
  },
}));
vi.mock("../../appSettings/store", () => ({
  loadAppSettings: () => ({ follow_up_suggestions: followUps.enabled }),
}));
vi.mock("../../notifications/osNotification", () => ({
  showAgentNotification: () => false,
}));

const { sendQueuedMessageNow, startHostConversations, stopHostConversations } =
  await import("./hostDriver");
const { readConversation, resetLive, stageConversation } =
  await import("./live");
const { forgetAgent } = await import("../forget");
const { trackedAgentIds } = await import("./folded");

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
    followUps.asked.length = 0;
    followUps.reply = ["Add the tests", "Commit it"];
    followUps.enabled = true;
    vi.useRealTimers();
  });

  it("lets go of an agent removed without a stop, as a deleted session's are", async () => {
    addAgent();
    started();
    line(INIT);
    line(reply("Done."));
    enqueueMessage(AGENT, { text: "and the signup" });
    await vi.advanceTimersByTimeAsync(100);
    expect(snapshot()).not.toBeNull();

    forgetAgent(AGENT);

    expect(snapshot()).toBeNull();
    expect(trackedAgentIds()).toEqual([]);
    expect(appState.agents.has(AGENT)).toBe(false);
    expect(appState.agentQueues.has(AGENT)).toBe(false);
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

  it("titles a chat from its first message with words, not an image-only one", async () => {
    addAgent();
    started();
    emitHostEvent(`agent:remote-message:${AGENT}`, {
      message: "(see attached images)",
      author: null,
    });
    line(INIT);
    line(reply("Done."));
    await vi.advanceTimersByTimeAsync(100);
    expect(snapshot()?.title).toBeUndefined();

    emitHostEvent(`agent:remote-message:${AGENT}`, {
      message: "fix the login",
      author: null,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(snapshot()?.title).toBe("Fix the login");
  });

  function finishTurn(text: string): void {
    line(INIT);
    line(reply(text));
    line({ type: "result", subtype: "success", duration_ms: 20_000 });
    emitHostEvent(`agent:status:${AGENT}`, "idle");
  }

  it("suggests follow-ups from the last message once a turn ends", async () => {
    addAgent();
    started();
    emitHostEvent(`agent:remote-message:${AGENT}`, { message: "fix it" });
    finishTurn("Fixed. Want me to add tests?");
    await vi.advanceTimersByTimeAsync(100);

    expect(followUps.asked).toEqual(["Fixed. Want me to add tests?"]);
    expect(snapshot()?.followUps).toEqual(["Add the tests", "Commit it"]);
  });

  it("clears follow-ups as soon as the next message goes in", async () => {
    addAgent();
    started();
    emitHostEvent(`agent:remote-message:${AGENT}`, { message: "fix it" });
    finishTurn("Fixed. Want me to add tests?");
    await vi.advanceTimersByTimeAsync(100);
    emitHostEvent(`agent:remote-message:${AGENT}`, { message: "commit" });
    await vi.advanceTimersByTimeAsync(100);

    expect(snapshot()?.followUps).toBeUndefined();
  });

  it("drops follow-ups that arrive after the next turn started", async () => {
    addAgent();
    started();
    emitHostEvent(`agent:remote-message:${AGENT}`, { message: "fix it" });
    finishTurn("Fixed.");
    emitHostEvent(`agent:remote-message:${AGENT}`, { message: "commit" });
    await vi.advanceTimersByTimeAsync(100);

    expect(followUps.asked).toEqual(["Fixed."]);
    expect(snapshot()?.followUps).toBeUndefined();
  });

  it("suggests nothing when the setting is off", async () => {
    followUps.enabled = false;
    addAgent();
    started();
    emitHostEvent(`agent:remote-message:${AGENT}`, { message: "fix it" });
    finishTurn("Fixed.");
    await vi.advanceTimersByTimeAsync(100);

    expect(followUps.asked).toEqual([]);
    expect(snapshot()?.followUps).toBeUndefined();
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

  it("sends a queued message into a busy agent's turn without interrupting it", async () => {
    addAgent("running");
    started();
    enqueueMessage(AGENT, { text: "first in line" });
    const urgent = enqueueMessage(AGENT, {
      text: "look at this too",
      author: "Sam",
    });

    await expect(sendQueuedMessageNow(AGENT, urgent.id)).resolves.toEqual({
      mid_turn: true,
    });
    expect(interrupted).toEqual([]);
    expect(sent).toEqual([{ agentId: AGENT, text: "look at this too" }]);
    await vi.advanceTimersByTimeAsync(100);
    expect(texts()).toEqual(["user: look at this too"]);
    expect(snapshot()?.messages[0]?.author).toBe("Sam");
    expect(appState.agentQueues.get(AGENT)?.map((m) => m.text)).toEqual([
      "first in line",
    ]);

    // The merged turn ends with one idle; the rest of the queue goes out once.
    appState.agents.get(AGENT)!.status = "idle";
    emitHostEvent(`agent:status:${AGENT}`, "idle");
    await vi.advanceTimersByTimeAsync(100);

    expect(sent.map((s) => s.text)).toEqual([
      "look at this too",
      "first in line",
    ]);
    expect(appState.agentQueues.get(AGENT)).toEqual([]);
  });

  it("holds back the rest of the queue while a mid-turn send is out", async () => {
    addAgent("running");
    started();
    const urgent = enqueueMessage(AGENT, { text: "look at this too" });
    enqueueMessage(AGENT, { text: "after that" });

    await sendQueuedMessageNow(AGENT, urgent.id);
    // A queue change while the agent reads idle mustn't dispatch a second one.
    appState.agents.get(AGENT)!.status = "idle";
    emitHostEvent(`agent:queue:${AGENT}`, []);
    await vi.advanceTimersByTimeAsync(100);

    expect(sent.map((s) => s.text)).toEqual(["look at this too"]);
  });

  it("sends a queued message straight away to an idle agent", async () => {
    addAgent();
    started();
    const urgent = { id: "q2", text: "this one", queued_at: 2 };
    // Staged directly: enqueueing to an idle agent would drain it at once.
    appState.agentQueues.set(AGENT, [
      { id: "q1", text: "first in line", queued_at: 1 },
      urgent,
    ]);

    await expect(sendQueuedMessageNow(AGENT, urgent.id)).resolves.toEqual({
      mid_turn: false,
    });
    await vi.advanceTimersByTimeAsync(100);

    expect(sent).toEqual([{ agentId: AGENT, text: "this one" }]);
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

  it("keeps runner stderr logs out of the transcript of a healthy run", async () => {
    addAgent();
    started();
    line(INIT);
    emitHostEvent(
      `agent:stderr:${AGENT}`,
      "[mcp-sdk] SEP-2352: stored OAuth credential has no issuer",
    );
    line(reply("Done."));
    emitHostEvent(`agent:exit:${AGENT}`, 0);

    expect(texts()).toEqual(["assistant: Done."]);
  });

  it("shows stderr diagnostics as they arrive and plain stderr once the run dies", async () => {
    addAgent();
    started();
    line(INIT);
    emitHostEvent(
      `agent:stderr:${AGENT}`,
      '[claude-code:unrecognized_model] {"model":"x"}',
    );
    emitHostEvent(`agent:stderr:${AGENT}`, "Error: session not found");
    expect(texts()).toEqual(["system: Unrecognized modelModel: x"]);

    emitHostEvent(`agent:exit:${AGENT}`, 1);

    expect(texts()).toEqual([
      "system: Unrecognized modelModel: x",
      "system: Error: session not found",
    ]);
    expect(snapshot()?.messages.at(-1)?.tone).toBe("error");
  });

  it("saves the mode and effort a resume should keep", async () => {
    addAgent();
    Object.assign(appState.agents.get(AGENT)!, {
      permissionMode: "plan",
      effort: "low",
    });
    started();
    line(INIT);
    line(reply("Planned."));
    emitHostEvent(`agent:exit:${AGENT}`, 0);

    expect(saved.at(-1)).toMatchObject({
      permissionMode: "plan",
      effort: "low",
    });
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
