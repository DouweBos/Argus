import type { AgentSession } from "./models";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({
  capture: vi.fn(),
  releaseSimulator: vi.fn(async () => undefined),
  releaseBrowser: vi.fn(async () => undefined),
  clearAuthFailure: vi.fn(),
  account: vi.fn((id: string): object | undefined => ({ id })),
  checkpoint: vi.fn(async () => ({ id: "cp1" })),
}));

vi.mock("../claudeAuth/accounts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveAccountForSession: (s?: { claude_account_id?: string | null }) =>
    s?.claude_account_id ?? "personal",
  envForAccount: () => ({ ...process.env }),
  getClaudeAccount: spies.account,
  clearAuthFailure: spies.clearAuthFailure,
}));
vi.mock("../telemetry/telemetry", () => ({ capture: spies.capture }));
vi.mock("./spawnStamp", () => ({ spawnConfigStamp: async () => "stamp" }));
vi.mock("../simulator/pool", () => ({
  simulatorPool: { releaseSimulator: spies.releaseSimulator },
}));
vi.mock("../browser/pool", () => ({
  webBrowserPool: { releaseBrowser: spies.releaseBrowser },
}));
vi.mock("./checkpoints", () => ({
  createCheckpoint: spies.checkpoint,
  recordTurnEnd: async () => undefined,
}));
vi.mock("./chatHistory", () => ({
  saveConversation: () => undefined,
  loadConversationByRunnerSession: () => null,
  loadHistoryIndex: () => [],
}));
vi.mock("../llm/titleGenerator", () => ({
  generateChatTitle: async () => "A title",
}));
vi.mock("../llm/followUps", () => ({ generateFollowUps: async () => null }));
vi.mock("../notifications/osNotification", () => ({
  showAgentNotification: () => false,
}));
vi.mock("../session/lastMessage", () => ({
  flushLastMessage: () => undefined,
  stampAgentMessage: () => undefined,
  stampUserMessage: () => undefined,
  stopLastMessageStamps: () => undefined,
}));
vi.mock("../session/triage", () => ({
  markSessionRead: () => undefined,
  markSessionUnread: () => undefined,
}));

const { addHostEventSink, resetHostEventSinks } =
  await import("@argus/host/bus");
const { appState } = await import("../../state");
const service = await import("./agentService");
const { pauseAgent, WAKE_TIMEOUT_MS } = await import("./lifecycle");
const { showsPaused } = await import("./lifecycleState");
const { forgetAgent } = await import("./forget");
const { agentMcpStatus } = await import("./mcpStatus");
const { clearQueue, listQueue } = await import("./messageQueue");
const { submitAgentMessage, rewindAgent } =
  await import("./conversation/actions");
const { sendQueuedMessageNow, startHostConversations, stopHostConversations } =
  await import("./conversation/hostDriver");
const { changeConversation, isInflight } =
  await import("./conversation/folded");
const { readConversation, resetLive } = await import("./conversation/live");
const { fakeClaude } = await import("./agentService.testkit");

let fake: ReturnType<typeof fakeClaude>;
let id: string;
const events: [string, unknown][] = [];

const on = (kind: string) =>
  events.filter(([c]) => c === `agent:${kind}:${id}`).map(([, p]) => p);
const agent = (): AgentSession => appState.agents.get(id)!;
const child = (n: number) => fake.spawns[n]!;
const tick = () => new Promise((r) => setTimeout(r, 0));

function userBubbles(): string[] {
  return (readConversation(id)?.messages ?? [])
    .filter((m) => m.role === "user")
    .map((m) => m.textBlocks.join(""));
}

function systemText(): string {
  return (readConversation(id)?.messages ?? [])
    .filter((m) => m.role === "system")
    .map((m) => m.textBlocks.join("\n"))
    .join("\n");
}

function gate(): { open: () => void; fail: (e: string) => void } {
  let open = (): void => {};
  let fail = (_e: string): void => {};
  const wait = new Promise<void>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  wait.catch(() => undefined);
  fake.control.init = () => wait;

  return { open, fail };
}

function failWakes(reason = "no CLI"): () => void {
  fake.control.preflight = async () => {
    throw new Error(reason);
  };

  return () => {
    fake.control.preflight = async () => undefined;
  };
}

/** One finished turn, stop hook and all. */
function finishTurn(n = 0, conversation = "conversation-1"): void {
  child(n).state("running");
  child(n).init(conversation);
  child(n).emit("turn-stop", { tasks: 0, scheduled: 0 });
  child(n).result();
  child(n).state("idle");
}

async function pausedAfterTurn(): Promise<void> {
  finishTurn();
  await pauseAgent(id, 60 * 60_000);
  events.length = 0;
}

async function setUp(): Promise<void> {
  vi.clearAllMocks();
  fake = fakeClaude();
  startHostConversations();
  id = (await service.launchAgent({ sessionId: "s1", permissionMode: "plan" }))
    .agent_id;
  events.length = 0;
  addHostEventSink((channel, args) => {
    events.push([channel, args[0]]);
  });
}

function tearDown(): void {
  clearQueue(id);
  stopHostConversations();
  resetHostEventSinks();
  resetLive();
  appState.agents.clear();
  appState.agentQueues.clear();
  appState.agentPendingPermissions.clear();
  appState.sessions.clear();
}

describe("pausing", () => {
  beforeEach(setUp);
  afterEach(tearDown);

  it("ends the process and keeps the agent idle", async () => {
    finishTurn();
    const before = agent();

    await pauseAgent(id, 60 * 60_000);

    expect(child(0).killed).toBe(true);
    expect(agent()).toBe(before);
    expect(agent().status).toBe("idle");
    expect(showsPaused(agent())).toBe(true);
    expect(on("paused")).toEqual([true]);
  });

  it("doesn't announce idle again, or an exit", async () => {
    finishTurn();
    events.length = 0;

    await pauseAgent(id, 60 * 60_000);

    expect(on("status")).toEqual([]);
    expect(on("exit")).toEqual([]);
  });

  it("keeps devices and account badges", async () => {
    await pausedAfterTurn();

    expect(spies.releaseSimulator).not.toHaveBeenCalled();
    expect(spies.releaseBrowser).not.toHaveBeenCalled();
    expect(spies.clearAuthFailure).not.toHaveBeenCalled();
  });

  it("doesn't bump the activity worktree cleanup reads", async () => {
    finishTurn();
    agent().lastEventAt = 42;

    await pauseAgent(id, 60 * 60_000);

    expect(agent().lastEventAt).toBe(42);
  });

  it("ignores what the old child still says", async () => {
    await pausedAfterTurn();

    child(0).state("running");
    child(0).emit("stderr", "bye");
    child(0).emit("exit", 1);

    expect(agent().status).toBe("idle");
    expect(events).toEqual([]);
  });

  it("is reported, with how long it was idle", async () => {
    await pausedAfterTurn();

    expect(spies.capture).toHaveBeenCalledWith("agent_paused", {
      had_turns: true,
      idle_bucket: "1-4h",
    });
  });

  it("answers MCP status with what it last knew", async () => {
    const servers = [{ name: "argus", status: "connected" }];
    const mcpStatus = vi.fn(async () =>
      servers.map((s) => ({ ...s, source: null, toolCount: 3, error: null })),
    );
    Object.assign(child(0), { mcpStatus });

    await pauseAgent(id, 60 * 60_000);
    mcpStatus.mockClear();

    await expect(agentMcpStatus(agent())).resolves.toMatchObject(servers);
    expect(mcpStatus).not.toHaveBeenCalled();
  });

  it("gives way to a send that beats the kill", async () => {
    finishTurn();
    let answer = (): void => {};
    Object.assign(child(0), {
      mcpStatus: () => new Promise((r) => (answer = () => r([]))),
    });
    const pausing = pauseAgent(id, 60 * 60_000);

    service.sendAgentMessage(id, "hello");
    expect(agent().status).toBe("running");
    answer();
    await pausing;

    expect(child(0).killed).toBe(false);
    expect(child(0).sent).toEqual(["hello"]);
    expect(fake.spawns).toHaveLength(1);
    expect(showsPaused(agent())).toBe(false);
  });

  it("wakes for a send that lands during the kill", async () => {
    finishTurn();
    child(0).dying = () => service.sendAgentMessage(id, "hello");

    await pauseAgent(id, 60 * 60_000);

    await vi.waitFor(() => expect(child(1).sent).toEqual(["hello"]));
    expect(child(1).args.resumeRef).toBe("conversation-1");
  });

  it("doesn't wake for a send interrupted during the kill", async () => {
    finishTurn();
    child(0).dying = async () => {
      service.sendAgentMessage(id, "hello");
      await service.interruptAgent(id);
    };

    await pauseAgent(id, 60 * 60_000);

    expect(fake.spawns).toHaveLength(1);
    expect(showsPaused(agent())).toBe(true);
    expect(listQueue(id).map((m) => m.text)).toEqual(["hello"]);
  });
});

describe("waking", () => {
  beforeEach(setUp);
  afterEach(tearDown);

  it("resumes on the same id, account, runner, model and mode", async () => {
    agent().model = "claude-haiku[1m]";
    appState.sessions.get("s1")!.model = "session-default";
    await pausedAfterTurn();
    appState.sessions.get("s1")!.claude_account_id = "work";

    await submitAgentMessage(id, { text: "again" });

    await vi.waitFor(() => expect(child(1).sent).toEqual(["again"]));
    expect(child(1).args).toMatchObject({
      agentId: id,
      resumeRef: "conversation-1",
      model: "claude-haiku[1m]",
      permissionMode: "plan",
    });
    expect(agent().accountId).toBe("personal");
    expect(agent().paused).toBeFalsy();
  });

  it("starts a never-used agent fresh", async () => {
    await pauseAgent(id, 60 * 60_000);

    await submitAgentMessage(id, { text: "first" });

    await vi.waitFor(() => expect(child(1).sent).toEqual(["first"]));
    expect(child(1).args.resumeRef).toBeNull();
  });

  it("resumes what followed a /clear", async () => {
    finishTurn();
    child(0).line({ type: "conversation_reset", session_id: "conversation-1" });
    finishTurn(0, "conversation-2");
    await pauseAgent(id, 60 * 60_000);

    await submitAgentMessage(id, { text: "again" });

    await vi.waitFor(() => expect(child(1).sent).toEqual(["again"]));
    expect(child(1).args.resumeRef).toBe("conversation-2");
  });

  it("is running and in flight before the send returns", async () => {
    await pausedAfterTurn();
    const { open } = gate();

    service.sendAgentMessage(id, "again");

    expect(agent().status).toBe("running");
    expect(isInflight(id)).toBe(true);
    expect(showsPaused(agent())).toBe(false);
    expect(on("paused")).toContain(false);
    const waited = vi.fn();
    const waiting = service.waitForAgent(id).then(waited);
    await tick();
    expect(waited).not.toHaveBeenCalled();

    open();
    await vi.waitFor(() => expect(child(1).sent).toEqual(["again"]));
    child(1).result({ result: "new answer" });
    child(1).state("running");
    child(1).state("idle");
    await waiting;

    expect(waited).toHaveBeenCalledWith({
      status: "idle",
      result: expect.objectContaining({ result: "new answer" }),
    });
  });

  it("delivers two sends in order, once, from one wake", async () => {
    await pausedAfterTurn();
    const { open } = gate();

    service.sendAgentMessage(id, "one");
    service.sendAgentMessage(id, "two");
    await vi.waitFor(() => expect(fake.spawns).toHaveLength(2));
    service.sendAgentMessage(id, "three");
    expect(child(1).sent).toEqual([]);
    open();

    await vi.waitFor(() =>
      expect(child(1).sent).toEqual(["one", "two", "three"]),
    );
    expect(fake.spawns).toHaveLength(2);
    expect(agent().inflightPrompts).toBe(3);
  });

  it("queues a submit behind the one it's waking for", async () => {
    await pausedAfterTurn();
    const { open } = gate();
    await submitAgentMessage(id, { text: "one" });

    const second = await submitAgentMessage(id, { text: "two" });
    open();

    expect(second).toEqual({ queued: true });
    await vi.waitFor(() => expect(child(1).sent).toEqual(["one"]));
    expect(listQueue(id).map((m) => m.text)).toEqual(["two"]);
  });

  it("isn't settled by the new child's own chatter", async () => {
    await pausedAfterTurn();
    const { open } = gate();
    service.sendAgentMessage(id, "again");
    await vi.waitFor(() => expect(fake.spawns).toHaveLength(2));

    child(1).state("idle");
    child(1).result();

    expect(agent().status).toBe("running");
    expect(agent().turnsCompleted).toBe(1);
    open();
    await vi.waitFor(() => expect(child(1).sent).toEqual(["again"]));
  });

  it.each([
    ["model", () => service.setAgentModel(id, "opus"), ["setModel", "opus"]],
    [
      "mode",
      () => service.setAgentPermissionMode(id, "auto"),
      ["setPermissionMode", "auto"],
    ],
    ["effort", () => service.setAgentEffort(id, "high"), ["setEffort", "high"]],
  ] as const)("wakes for a change of %s", async (trigger, act, call) => {
    await pausedAfterTurn();

    await act();

    expect(child(1).calls).toContainEqual(call);
    expect(spies.capture).toHaveBeenCalledWith("agent_woken", {
      trigger,
      success: true,
      duration_bucket: expect.any(String),
    });
    expect(agent().status).toBe("idle");
  });

  it("doesn't wake to be interrupted", async () => {
    await pausedAfterTurn();

    await service.interruptAgent(id);

    expect(fake.spawns).toHaveLength(1);
    expect(agent().paused).toBe(true);
  });

  it("keeps waiters that joined before the pause", async () => {
    const waiting = service.waitForAgent(id);
    await pauseAgent(id, 60 * 60_000);
    service.sendAgentMessage(id, "first");
    await vi.waitFor(() => expect(child(1).sent).toEqual(["first"]));

    finishTurn(1);

    await expect(waiting).resolves.toMatchObject({ status: "idle" });
  });
});

describe("what a replacement child carries over", () => {
  beforeEach(setUp);
  afterEach(tearDown);

  function dress(): AgentSession {
    const a = agent();
    Object.assign(a, {
      model: "claude-haiku[1m]",
      effort: "high",
      appendSystemPrompt: "EXTRA PROMPT",
      platformsOverride: ["web"],
      allowRules: ["Bash(npm *)"],
      pendingSeed: "SEED",
      pendingNote: "NOTE",
      prePlanPermissionMode: "auto",
      profile: { disabledTools: ["device-control"] },
      mcpServers: [],
      createdAt: 7,
      toolUsesTotal: 4,
      costUsd: 1.5,
      tokensTotal: 99,
      lastToolName: "Edit",
      lastToolUseAt: 8,
      contextWindow: 200_000,
      resolvedModel: "claude-haiku-5-5",
    });

    return a;
  }

  const KEPT = [
    "agentId",
    "allowRules",
    "appendSystemPrompt",
    "contextWindow",
    "costUsd",
    "createdAt",
    "effort",
    "exitWaiters",
    "lastToolName",
    "lastToolUseAt",
    "mcpServers",
    "model",
    "pendingNote",
    "pendingSeed",
    "permissionMode",
    "platformsOverride",
    "prePlanPermissionMode",
    "profile",
    "resolvedModel",
    "resultSummary",
    "tokensTotal",
    "toolUsesTotal",
    "turnsCompleted",
    "turnWaiters",
  ] as const;

  const REPLACEMENTS = [
    [
      "a wake",
      async () => {
        await pauseAgent(id, 60 * 60_000);
        await service.ensureAwake(id, "message");
      },
    ],
    [
      "a respawn",
      () =>
        service.respawnAgent(id, {
          keepModel: true,
          resumeRef: "conversation-1",
        }),
    ],
  ] as const;

  it.each(REPLACEMENTS)("%s keeps every field", async (_what, replace) => {
    finishTurn();
    appState.sessions.get("s1")!.model = "session-default";
    const before = { ...dress() };

    await replace();

    const kept = (a: AgentSession) =>
      Object.fromEntries(KEPT.map((field) => [field, a[field]]));
    expect(kept(agent())).toEqual(kept(before));
    expect(child(1).args.systemPrompt).toContain("EXTRA PROMPT");
    expect(child(1).args.allowRules).toEqual(["Bash(npm *)"]);
    expect(child(1).calls).toContainEqual(["setEffort", "high"]);
  });

  it("drops only model and effort for another runner", async () => {
    dress();

    await service.respawnAgent(id);

    expect(agent().model).toBeNull();
    expect(agent().effort).toBeNull();
    expect(agent().appendSystemPrompt).toBe("EXTRA PROMPT");
  });

  it("sends the seed and note with the waking message", async () => {
    dress();
    await pauseAgent(id, 60 * 60_000);

    service.sendAgentMessage(id, "hello");

    await vi.waitFor(() => expect(child(1).sent).toHaveLength(1));
    expect(child(1).sent[0]).toMatch(/NOTE[\s\S]*SEED[\s\S]*hello/);
  });

  it("remembers an allow rule when it's given", () => {
    service.respondToPermission(id, "t1", "allow", "Edit", true);

    expect(agent().allowRules).toEqual(["Edit"]);
  });
});

describe("a wake that fails", () => {
  beforeEach(setUp);
  afterEach(tearDown);

  it("stays paused and queues the message without a second bubble", async () => {
    await pausedAfterTurn();
    const fixed = failWakes();

    await submitAgentMessage(id, { text: "full text", displayText: "short" });

    await vi.waitFor(() => expect(listQueue(id)).toHaveLength(1));
    expect(showsPaused(agent())).toBe(true);
    expect(agent().status).toBe("idle");
    expect(on("status")).toEqual(["running", "idle"]);
    expect(listQueue(id)[0]).toMatchObject({
      text: "full text",
      display_text: "short",
    });
    expect(systemText()).toContain("Couldn't resume this chat: no CLI");
    expect(spies.capture).toHaveBeenCalledWith(
      "agent_woken",
      expect.objectContaining({ trigger: "message", success: false }),
    );

    fixed();
    await sendQueuedMessageNow(id, listQueue(id)[0]!.id);

    await vi.waitFor(() => expect(child(1).sent).toEqual(["full text"]));
    expect(userBubbles()).toEqual(["short"]);
    expect(spies.checkpoint).toHaveBeenCalledTimes(1);
  });

  it("doesn't retry on its own", async () => {
    await pausedAfterTurn();
    const preflight = vi.fn(async () => {
      throw new Error("no CLI");
    });
    fake.control.preflight = preflight;

    await submitAgentMessage(id, { text: "again" });
    await vi.waitFor(() => expect(listQueue(id)).toHaveLength(1));
    await tick();
    await tick();

    expect(preflight).toHaveBeenCalledTimes(1);
  });

  it("retries on the next send, the held message first", async () => {
    await pausedAfterTurn();
    const fixed = failWakes();
    await submitAgentMessage(id, { text: "one" });
    await vi.waitFor(() => expect(listQueue(id)).toHaveLength(1));
    fixed();

    await submitAgentMessage(id, { text: "two" });

    await vi.waitFor(() => expect(child(1).sent).toEqual(["one"]));
    expect(listQueue(id).map((m) => m.text)).toEqual(["two"]);
    finishTurn(1);
    await vi.waitFor(() => expect(child(1).sent).toEqual(["one", "two"]));
    expect(userBubbles()).toEqual(["one", "two"]);
  });

  it("puts a parent's retry behind what it couldn't deliver", async () => {
    await pausedAfterTurn();
    const fixed = failWakes();
    service.sendAgentMessage(id, "one");
    await vi.waitFor(() => expect(listQueue(id)).toHaveLength(1));
    fixed();

    service.sendAgentMessage(id, "two");

    await vi.waitFor(() => expect(child(1).sent).toEqual(["one", "two"]));
    expect(listQueue(id)).toEqual([]);
  });

  it("doesn't answer a waiter with the previous turn's result", async () => {
    await pausedAfterTurn();
    failWakes();

    service.sendAgentMessage(id, "again");
    const waited = await service.waitForAgent(id);

    expect(waited.result).toMatchObject({
      subtype: "error",
      result: expect.stringContaining("no CLI"),
    });
  });

  it("puts the slot back when the new child dies in its handshake", async () => {
    await pausedAfterTurn();
    const paused = agent();
    const { fail } = gate();
    service.sendAgentMessage(id, "again");
    await vi.waitFor(() => expect(fake.spawns).toHaveLength(2));

    child(1).emit("exit", 1);
    fail("died");

    await vi.waitFor(() => expect(listQueue(id)).toHaveLength(1));
    expect(agent()).toBe(paused);
    expect(child(1).killed).toBe(true);
    expect(on("exit")).toEqual([]);
    expect(spies.releaseSimulator).not.toHaveBeenCalled();
  });

  it("gives up on a handshake that never ends", async () => {
    await pausedAfterTurn();
    gate();
    vi.useFakeTimers();
    try {
      const refusal = service
        .setAgentModel(id, "opus")
        .catch((e: unknown) => String(e));
      await vi.advanceTimersByTimeAsync(WAKE_TIMEOUT_MS);
      await expect(refusal).resolves.toMatch(/too long/);
    } finally {
      vi.useRealTimers();
    }

    expect(showsPaused(agent())).toBe(true);
    expect(child(1).killed).toBe(true);
  });

  it("refuses a runner that's gone rather than fall back", async () => {
    await pausedAfterTurn();
    agent().runner = {
      ...agent().runner,
      id: "custom:gone",
      displayName: "My Gateway",
    };

    await expect(service.setAgentModel(id, "x")).rejects.toMatch(
      /My Gateway isn't set up/,
    );
    expect(fake.spawns).toHaveLength(1);
  });

  it("refuses an account that was removed", async () => {
    await pausedAfterTurn();
    spies.account.mockReturnValueOnce(undefined);

    await expect(service.setAgentModel(id, "x")).rejects.toMatch(
      /account it ran on was removed/,
    );
  });

  it("keeps a session whose folder is out of reach", async () => {
    await pausedAfterTurn();
    appState.sessions.get("s1")!.path = "/Volumes/unplugged/worktree";

    await expect(service.setAgentModel(id, "x")).rejects.toMatch(
      /folder isn't available/,
    );
    expect(appState.sessions.has("s1")).toBe(true);
  });
});

describe("what overtakes a wake", () => {
  beforeEach(setUp);
  afterEach(tearDown);

  /** A wake held just before its child exists. */
  async function spawning(): Promise<() => void> {
    await pausedAfterTurn();
    let open = (): void => {};
    const wait = new Promise<void>((resolve) => (open = resolve));
    fake.control.preflight = () => wait;
    service.sendAgentMessage(id, "again");

    return open;
  }

  /** A wake held in its child's handshake. */
  async function handshaking(): Promise<() => void> {
    await pausedAfterTurn();
    const { open } = gate();
    service.sendAgentMessage(id, "again");
    await vi.waitFor(() => expect(fake.spawns).toHaveLength(2));

    return open;
  }

  it.each([
    ["stop", () => service.stopAgent(id)],
    ["delete or move", async () => forgetAgent(id)],
    ["quit", () => service.destroyAllAgents()],
  ] as const)("a %s while spawning kills the orphan", async (_what, end) => {
    const open = await spawning();

    const ending = end();
    open();
    await ending;

    await vi.waitFor(() => expect(child(1).killed).toBe(true));
    expect(child(1).sent).toEqual([]);
    expect(appState.agents.has(id)).toBe(false);
  });

  it("a stop in the handshake kills the new child", async () => {
    const open = await handshaking();

    await service.stopAgent(id);
    open();
    await tick();

    expect(child(1).killed).toBe(true);
    expect(child(1).sent).toEqual([]);
    expect(appState.agents.has(id)).toBe(false);
    expect(spies.releaseSimulator).toHaveBeenCalled();
  });

  it("a quit in the handshake kills the new child", async () => {
    const open = await handshaking();

    const quitting = service.destroyAllAgents();
    open();
    await quitting;

    expect(child(1).killed).toBe(true);
    expect(child(1).sent).toEqual([]);
  });

  it("an interrupt puts the messages back in the queue", async () => {
    const open = await handshaking();

    await service.interruptAgent(id);
    open();
    await tick();

    expect(child(1).sent).toEqual([]);
    expect(child(1).calls).not.toContainEqual(["interrupt"]);
    expect(agent().status).toBe("idle");
    expect(listQueue(id).map((m) => m.text)).toEqual(["again"]);
  });

  it("a rewind drops the messages and forks", async () => {
    await pausedAfterTurn();
    changeConversation(id, (c) => ({
      ...c,
      messages: [
        {
          id: "m1",
          role: "user",
          textBlocks: ["first"],
          toolCalls: [],
          timestamp: 1,
        },
      ],
    }));
    const { open } = gate();
    service.sendAgentMessage(id, "again");
    await vi.waitFor(() => expect(fake.spawns).toHaveLength(2));

    const rewinding = rewindAgent(id, "m1", { resend: { text: "edited" } });
    open();
    await rewinding;

    expect(child(1).sent).toEqual([]);
    expect(child(1).killed).toBe(true);
    expect(child(2).args.resumeRef).toBeNull();
    expect(child(2).sent).toEqual(["edited"]);
    expect(listQueue(id)).toEqual([]);
  });
});

describe("what overtakes a respawn", () => {
  beforeEach(setUp);
  afterEach(tearDown);

  it("a delete during the kill doesn't bring the agent back", async () => {
    child(0).dying = () => forgetAgent(id);

    await expect(service.respawnAgent(id)).rejects.toMatch(/went away/);

    expect(appState.agents.has(id)).toBe(false);
    expect(child(1).killed).toBe(true);
  });

  it("a live agent's setting keeps its place ahead of a send", async () => {
    const order: string[] = [];
    child(0).setModel = async () => {
      order.push("model");
    };
    child(0).send = () => {
      order.push("send");
    };

    const set = service.setAgentModel(id, "opus");
    service.sendAgentMessage(id, "hello");
    await set;

    expect(order).toEqual(["model", "send"]);
  });
});

describe("a paused agent that goes away", () => {
  beforeEach(setUp);
  afterEach(tearDown);

  it("releases what an exit would have on a delete", async () => {
    await pausedAfterTurn();

    forgetAgent(id);

    expect(spies.releaseSimulator).toHaveBeenCalledWith(id);
    expect(spies.releaseBrowser).toHaveBeenCalledWith(id);
  });

  it("answers whoever waits on it when it stops", async () => {
    await pauseAgent(id, 60 * 60_000);
    const waiting = service.waitForAgent(id);

    await service.stopAgent(id);

    await expect(waiting).resolves.toMatchObject({ status: "stopped" });
  });

  it("wakes on the picked account when that's switched", async () => {
    await pausedAfterTurn();
    appState.sessions.get("s1")!.claude_account_id = "work";

    await service.respawnAgent(id, {
      keepModel: true,
      resumeRef: "conversation-1",
    });

    expect(agent().accountId).toBe("work");
    expect(showsPaused(agent())).toBe(false);
    expect(on("paused")).toEqual([false]);
  });
});
