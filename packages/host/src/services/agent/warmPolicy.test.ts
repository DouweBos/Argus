import type { AgentSession } from "./models";
import type { NewSpare, SpareEvent } from "./spares";
import type { Session } from "../session/models";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rateLimited: false }));
vi.mock("../claudeAuth/accounts", () => ({
  resolveAccountForSession: () => "personal",
  getClaudeAccount: () => ({ id: "personal", rate_limited: h.rateLimited }),
}));

const { emitHostEvent, resetHostEventSinks } = await import("@argus/host/bus");
const { appState } = await import("../../state");
const { closeConnection, runInConnection } =
  await import("../remote/connectionScope");
const { getSpare, hasSpare, onSpareEvent, takeSpare } =
  await import("./spares");
const { setViewingSession, startWarmPolicy, stopWarmPolicy } =
  await import("./warmPolicy");

const spawn =
  vi.fn<(sessionId: string, runnerId?: string) => Promise<NewSpare>>();
const kills: Record<string, ReturnType<typeof vi.fn>> = {};

function fakeSpare(sessionId: string, runnerId = "claude-code"): NewSpare {
  const kill = vi.fn(async () => undefined);
  kills[sessionId] = kill;
  const agent = {
    agentId: `warm-${sessionId}`,
    sessionId,
    runner: { id: runnerId },
    accountId: "personal",
    handle: { kill, cleanup: () => {}, on: () => {} },
  } as unknown as AgentSession;

  return { agent, configStamp: "stamp" };
}

function addSession(id: string, status: Session["status"] = "ready"): void {
  appState.sessions.set(id, {
    id,
    path: `/tmp/${id}`,
    repo_root: "/repo",
    status,
    runner_id: "claude-code",
  } as unknown as Session);
}

/** Let fills, spare events and their reconciles settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

function view(conn: string, sessionId: string | null, runnerId?: string): void {
  runInConnection(conn, () => setViewingSession(sessionId, { runnerId }));
}

const take = (sessionId: string) =>
  takeSpare(sessionId, {
    runnerId: "claude-code",
    accountId: "personal",
    configStamp: "stamp",
  });

const events: SpareEvent[] = [];
let off: () => void;
let maxSpares: number;

describe("warm policy", () => {
  beforeEach(() => {
    resetHostEventSinks();
    maxSpares = 1;
    h.rateLimited = false;
    spawn
      .mockReset()
      .mockImplementation(async (id, runner) => fakeSpare(id, runner));
    addSession("s1");
    addSession("s2");
    startWarmPolicy({ spawn, maxSpares: () => maxSpares, spareIdleMs: 30 });
    off = onSpareEvent((e) => events.push(e));
  });

  afterEach(() => {
    off();
    closeConnection("c1");
    closeConnection("c2");
    stopWarmPolicy();
    appState.sessions.clear();
    events.length = 0;
  });

  it("keeps one spare for a session two clients look at", async () => {
    view("c1", "s1");
    view("c2", "s1");
    await settle();

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(hasSpare("s1")).toBe(true);
  });

  it("replaces a taken spare while the session is still viewed", async () => {
    view("c1", "s1");
    await settle();
    take("s1");
    await settle();

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(hasSpare("s1")).toBe(true);
  });

  it("leaves a started agent alone when another client looks away", async () => {
    view("c1", "s1");
    view("c2", "s1");
    await settle();
    const started = take("s1")!;
    view("c2", null);
    closeConnection("c2");
    await settle();

    expect(started.handle.kill).not.toHaveBeenCalled();
  });

  it("warms the most recently viewed session and evicts the other", async () => {
    view("c1", "s1");
    await settle();
    view("c2", "s2");
    await settle();

    expect(hasSpare("s2")).toBe(true);
    expect(hasSpare("s1")).toBe(false);
    expect(events).toContainEqual({
      type: "discarded",
      sessionId: "s1",
      reason: "evicted",
    });
  });

  it("warms both with room for two", async () => {
    maxSpares = 2;
    view("c1", "s1");
    view("c2", "s2");
    await settle();

    expect(hasSpare("s1")).toBe(true);
    expect(hasSpare("s2")).toBe(true);
  });

  it("drops a spare nobody has looked at for the idle window", async () => {
    view("c1", "s1");
    await settle();
    closeConnection("c1");

    expect(hasSpare("s1")).toBe(true);
    await new Promise((r) => setTimeout(r, 60));

    expect(hasSpare("s1")).toBe(false);
    expect(events).toContainEqual({
      type: "discarded",
      sessionId: "s1",
      reason: "idle",
    });
  });

  it("doesn't retry a failed spawn until the view changes", async () => {
    spawn.mockRejectedValueOnce("no cli");
    view("c1", "s1");
    await settle();
    emitHostEvent("session:updated", { id: "s1" });
    view("c1", "s1");
    await settle();

    expect(spawn).toHaveBeenCalledTimes(1);

    view("c1", "s2");
    view("c1", "s1");
    await settle();

    expect(spawn).toHaveBeenCalledTimes(3);
    expect(hasSpare("s1")).toBe(true);
  });

  it("waits for the session to be ready", async () => {
    addSession("s1", "initializing");
    view("c1", "s1");
    await settle();

    expect(spawn).not.toHaveBeenCalled();

    addSession("s1");
    emitHostEvent("session:updated", { id: "s1", status: "ready" });
    await settle();

    expect(hasSpare("s1")).toBe(true);
  });

  it("drops the spare of a deleted session", async () => {
    view("c1", "s1");
    await settle();
    appState.sessions.delete("s1");
    emitHostEvent("session:deleted", "s1");
    await settle();

    expect(hasSpare("s1")).toBe(false);
    expect(kills.s1).toHaveBeenCalled();
  });

  it("warms nothing while the account is rate limited", async () => {
    h.rateLimited = true;
    view("c1", "s1");
    await settle();

    expect(spawn).not.toHaveBeenCalled();
  });

  it("re-warms under the runner the start composer picked", async () => {
    view("c1", "s1");
    await settle();
    view("c1", "s1", "custom:apex");
    await settle();

    expect(events).toContainEqual({
      type: "discarded",
      sessionId: "s1",
      reason: "runner",
    });
    expect(getSpare("s1")?.agent.runner.id).toBe("custom:apex");
  });

  it("drops spares in a project whose config changed", async () => {
    view("c1", "s1");
    await settle();
    emitHostEvent("argus_config:changed", { repoRoot: "/repo" });
    await settle();

    expect(events).toContainEqual({
      type: "discarded",
      sessionId: "s1",
      reason: "config",
    });
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
