import type { AgentSession } from "./models";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const emitted: [string, unknown][] = [];
vi.mock("@argus/host/bus", () => ({
  emitHostEvent: (channel: string, payload: unknown) => {
    emitted.push([channel, payload]);
  },
}));

const project = { enabled: true };
vi.mock("../session/argusConfig", () => ({
  loadArgusConfig: () => ({ auto_continue_on_limit: project.enabled }),
}));

const { appState } = await import("../../state");
const {
  cancelLimitResume,
  dismissLimitResume,
  forgetLimitResume,
  limitResumeAt,
  noteLimitHit,
  noteRateLimitLine,
  onTurnResult,
} = await import("./limitResume");

const rejected = (resetsAtSec: number) =>
  JSON.stringify({
    type: "rate_limit_event",
    rate_limit_info: { status: "rejected", resetsAt: resetsAtSec },
  });

function addAgent(status = "idle"): AgentSession {
  const session = { agentId: "a1", sessionId: "s1", status };
  appState.agents.set("a1", session as unknown as AgentSession);
  appState.sessions.set("s1", { repo_root: "/repo" } as never);

  return session as unknown as AgentSession;
}

function hitLimit(resetsInMs: number): void {
  noteRateLimitLine(
    "a1",
    rejected(Math.floor((Date.now() + resetsInMs) / 1000)),
  );
  noteLimitHit("a1");
}

describe("auto-continue after a plan limit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
    project.enabled = true;
    emitted.length = 0;
    addAgent();
  });

  afterEach(() => {
    forgetLimitResume("a1");
    appState.agents.clear();
    appState.sessions.clear();
    vi.useRealTimers();
  });

  it("sends continue once the reported reset has passed", () => {
    const send = vi.fn();
    hitLimit(30 * 60_000);
    onTurnResult("a1", send);

    vi.advanceTimersByTime(30 * 60_000);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(send).toHaveBeenCalledWith("continue");
    expect(emitted).toContainEqual([
      "agent:remote-message:a1",
      { message: "continue", author: "Argus" },
    ]);
  });

  it("announces the pending continue and clears it on cancel", () => {
    hitLimit(30 * 60_000);
    onTurnResult("a1", vi.fn());
    const due = limitResumeAt("a1");
    expect(due).toBe(Date.now() + 31 * 60_000);

    cancelLimitResume("a1");
    expect(limitResumeAt("a1")).toBeNull();
    expect(
      emitted.filter(([c]) => c === "agent:limit-resume:a1").map(([, p]) => p),
    ).toEqual([due, null]);
  });

  it("stays dismissed through refused sends until a turn gets through", () => {
    const send = vi.fn();
    hitLimit(60_000);
    onTurnResult("a1", send);
    dismissLimitResume("a1");
    expect(limitResumeAt("a1")).toBeNull();

    // A message sent while still limited is refused again.
    hitLimit(60_000);
    onTurnResult("a1", send);
    expect(limitResumeAt("a1")).toBeNull();

    // One that gets through re-enables it for the next stall.
    onTurnResult("a1", send);
    hitLimit(60_000);
    onTurnResult("a1", send);
    expect(limitResumeAt("a1")).not.toBeNull();
    vi.advanceTimersByTime(3 * 60_000);
    expect(send).toHaveBeenCalledOnce();
  });

  it("does nothing when the project hasn't opted in", () => {
    project.enabled = false;
    const send = vi.fn();
    hitLimit(60_000);
    onTurnResult("a1", send);
    vi.advanceTimersByTime(60 * 60_000);
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores turns that didn't hit the limit", () => {
    const send = vi.fn();
    onTurnResult("a1", send);
    vi.advanceTimersByTime(2 * 60 * 60_000);
    expect(send).not.toHaveBeenCalled();
  });

  it("is cancelled by any other send", () => {
    const send = vi.fn();
    hitLimit(60_000);
    onTurnResult("a1", send);
    cancelLimitResume("a1");
    vi.advanceTimersByTime(60 * 60_000);
    expect(send).not.toHaveBeenCalled();
  });

  it("skips the continue when the agent is already busy", () => {
    const send = vi.fn();
    hitLimit(60_000);
    onTurnResult("a1", send);
    addAgent("running");
    vi.advanceTimersByTime(5 * 60_000);
    expect(send).not.toHaveBeenCalled();
  });

  it("falls back to an hour when no reset time was reported", () => {
    const send = vi.fn();
    noteLimitHit("a1");
    onTurnResult("a1", send);
    vi.advanceTimersByTime(59 * 60_000);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(send).toHaveBeenCalledOnce();
  });

  it("gives up after repeated continues that hit the limit again", () => {
    const send = vi.fn();
    for (let i = 0; i < 6; i++) {
      hitLimit(60_000);
      onTurnResult("a1", send);
      vi.advanceTimersByTime(3 * 60_000);
    }
    expect(send).toHaveBeenCalledTimes(5);
  });
});
