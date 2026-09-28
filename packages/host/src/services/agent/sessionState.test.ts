import type { AgentSession } from "./models";
import { beforeEach, describe, expect, it, vi } from "vitest";

const emitted: [string, unknown][] = [];
vi.mock("@argus/host/bus", () => ({
  emitHostEvent: (channel: string, payload: unknown) => {
    emitted.push([channel, payload]);
  },
}));

const { appState } = await import("../../state");
const { onStreamLine } = await import("./agentService");

const state = (s: string) =>
  JSON.stringify({
    type: "system",
    subtype: "session_state_changed",
    state: s,
  });
const result = JSON.stringify({
  type: "result",
  subtype: "success",
  result: "done",
  duration_ms: 10,
});

function addAgent(over: Partial<AgentSession> = {}): AgentSession {
  const session = {
    agentId: "a1",
    sessionId: "s1",
    status: "running",
    emitsSessionState: false,
    turnWaiters: [],
    turnsCompleted: 0,
    inflightPrompts: 1,
    costUsd: 0,
    toolUsesTotal: 0,
    lastEventAt: 0,
    lastToolUseAt: null,
    lastToolName: null,
    resultSummary: null,
    ...over,
  } as unknown as AgentSession;
  appState.agents.set("a1", session);

  return session;
}

const statuses = () =>
  emitted.filter(([c]) => c === "agent:status:a1").map(([, p]) => p);

describe("agent status from the CLI's session state", () => {
  beforeEach(() => {
    appState.agents.clear();
    emitted.length = 0;
  });

  it("stays running through a result until the CLI reports idle", () => {
    const session = addAgent();
    const waiter = vi.fn();
    session.turnWaiters.push(waiter);

    onStreamLine("a1", state("running"));
    onStreamLine("a1", result);
    expect(session.status).toBe("running");
    expect(session.turnsCompleted).toBe(1);
    expect(waiter).not.toHaveBeenCalled();

    onStreamLine("a1", state("idle"));
    expect(session.status).toBe("idle");
    expect(waiter).toHaveBeenCalledWith("idle");
    expect(statuses()).toEqual(["idle"]);
  });

  it("reports a pending permission as requires_action", () => {
    const session = addAgent();
    onStreamLine("a1", state("requires_action"));
    expect(session.status).toBe("requires_action");
    expect(statuses()).toEqual(["requires_action"]);
  });

  it("falls back to result for CLIs without state events", () => {
    const session = addAgent();
    const waiter = vi.fn();
    session.turnWaiters.push(waiter);

    onStreamLine("a1", result);
    expect(session.status).toBe("idle");
    expect(waiter).toHaveBeenCalledWith("idle");
    expect(statuses()).toEqual(["idle"]);
  });
});
