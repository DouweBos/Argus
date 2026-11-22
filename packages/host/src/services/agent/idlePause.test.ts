import type { PauseBlocker, PauseChecks } from "./idlePause";
import type { AgentSession } from "./models";
import type { Session } from "../session/models";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appState } from "../../state";
import { saveAppSettings } from "../appSettings/store";
import { newBackgroundState } from "./backgroundState";
import {
  pauseBlocker,
  SWEEP_INTERVAL_MS,
  startIdlePause,
  stopIdlePause,
  sweepIdleAgents,
} from "./idlePause";

const MINUTE = 60_000;

function agent(over: Partial<AgentSession> = {}): AgentSession {
  return {
    agentId: "a1",
    sessionId: "s1",
    runner: { id: "claude-code" },
    status: "idle",
    inflightPrompts: 0,
    turnsCompleted: 3,
    resumeRef: "conversation-1",
    background: newBackgroundState(false),
    idleSince: 0,
    ...over,
  } as unknown as AgentSession;
}

function session(over: object = {}): Session {
  return {
    id: "s1",
    path: "/worktree",
    kind: "worktree",
    status: "ready",
    ...over,
  } as unknown as Session;
}

function checks(over: Partial<PauseChecks> = {}): PauseChecks {
  return {
    inflight: () => false,
    inTransition: () => false,
    limitResumeAt: () => null,
    mcpOpen: () => false,
    pendingPrompts: () => 0,
    queued: () => 0,
    session: () => session(),
    transcriptExists: () => true,
    ...over,
  };
}

const background = (over: object) => ({
  background: { ...newBackgroundState(false), ...over },
});

type Case = [
  what: string,
  blocker: PauseBlocker | null,
  agent?: Partial<AgentSession>,
  checks?: Partial<PauseChecks>,
];

const CASES: Case[] = [
  ["an idle, used agent", null],
  ["a never-used agent", null, { turnsCompleted: 0, resumeRef: null }],
  [
    "a runner derived from Claude Code",
    null,
    { runner: { id: "custom:x", baseRunnerId: "claude-code" } as never },
  ],
  [
    "a project root",
    null,
    {},
    { session: () => session({ kind: "project_root" }) },
  ],
  [
    "a scratch pad",
    null,
    {},
    { session: () => session({ kind: "scratch_pad" }) },
  ],
  ["a paused agent", "paused", { paused: true }],
  ["codex", "runner", { runner: { id: "codex" } as never }],
  [
    "a runner derived from Codex",
    "runner",
    { runner: { id: "custom:y", baseRunnerId: "codex" } as never },
  ],
  ["a stopped agent", "not_running", { status: "stopped" }],
  ["a failed agent", "not_running", { status: "error" }],
  ["a running turn", "working", { status: "running" }],
  ["a turn waiting on the user", "working", { status: "requires_action" }],
  ["a prompt on its way", "working", { inflightPrompts: 1 }],
  [
    "a submit awaiting its checkpoint",
    "in_flight",
    {},
    { inflight: () => true },
  ],
  ["a permission or secret prompt", "prompt", {}, { pendingPrompts: () => 1 }],
  ["queued messages", "queued", {}, { queued: () => 2 }],
  ["a background task", "background_task", background({ tasks: 1 })],
  ["a wakeup, loop or cron", "scheduled", background({ scheduled: 1 })],
  ["an unknown schedule", "schedule_unknown", background({ scheduled: null })],
  ["no background state at all", "schedule_unknown", { background: undefined }],
  ["an open MCP call or sign-in", "mcp", {}, { mcpOpen: () => true }],
  ["a scheduled limit resume", "limit_resume", {}, { limitResumeAt: () => 9 }],
  ["a respawn or rewind", "transition", {}, { inTransition: () => true }],
  ["a silenced restore", "transition", { suppressStatus: true }],
  [
    "an automation's host",
    "automation_host",
    {},
    { session: () => session({ kind: "automation_host" }) },
  ],
  ["a session that's gone", "session", {}, { session: () => undefined }],
  [
    "a session still setting up",
    "session",
    {},
    { session: () => session({ status: "initializing" }) },
  ],
  [
    "a session on an unplugged drive",
    "session",
    {},
    { session: () => session({ availability: "unavailable" }) },
  ],
  [
    "no transcript file",
    "no_transcript",
    {},
    { transcriptExists: () => false },
  ],
  ["turns but no resume id", "no_transcript", { resumeRef: null }],
  [
    "a resume without a file, before any turn",
    "no_transcript",
    { turnsCompleted: 0 },
    { transcriptExists: () => false },
  ],
];

describe("pauseBlocker", () => {
  it.each(CASES)("%s → %s", (_what, blocker, overAgent, overChecks) => {
    expect(pauseBlocker(agent(overAgent), checks(overChecks))).toBe(blocker);
  });
});

describe("the sweep", () => {
  afterEach(() => {
    appState.agents.clear();
    saveAppSettings({ agent_idle_timeout_minutes: undefined });
    stopIdlePause();
    vi.useRealTimers();
  });

  function sweep(
    at: number,
    over: Partial<PauseChecks> = {},
    timeout: number | null = 60,
  ) {
    const pause = vi.fn(async () => undefined);
    sweepIdleAgents({
      checks: checks(over),
      now: () => at,
      pause,
      ...(timeout === null ? {} : { timeoutMinutes: () => timeout }),
    });

    return pause;
  }

  it("pauses once the timeout is up", () => {
    appState.agents.set("a1", agent());

    expect(sweep(59 * MINUTE)).not.toHaveBeenCalled();
    expect(sweep(60 * MINUTE)).toHaveBeenCalledWith("a1", 60 * MINUTE);
  });

  it("never pauses on a timeout of 0", () => {
    appState.agents.set("a1", agent());

    expect(sweep(1e10, {}, 0)).not.toHaveBeenCalled();
  });

  it("pauses at 60 minutes when nothing is set", () => {
    appState.agents.set("a1", agent());

    expect(sweep(59 * MINUTE, {}, null)).not.toHaveBeenCalled();
    expect(sweep(60 * MINUTE, {}, null)).toHaveBeenCalled();
  });

  it("follows the setting", () => {
    appState.agents.set("a1", agent());
    saveAppSettings({ agent_idle_timeout_minutes: 15 });
    expect(sweep(15 * MINUTE, {}, null)).toHaveBeenCalled();

    saveAppSettings({ agent_idle_timeout_minutes: 0 });
    expect(sweep(1e10, {}, null)).not.toHaveBeenCalled();
  });

  it("waits the whole timeout again after a blocker", () => {
    appState.agents.set("a1", agent());
    sweep(50 * MINUTE, { queued: () => 1 });

    expect(sweep(70 * MINUTE)).not.toHaveBeenCalled();
    expect(sweep(110 * MINUTE)).toHaveBeenCalled();
  });

  it("doesn't move what worktree cleanup reads", () => {
    const a = agent({ lastEventAt: 7 });
    appState.agents.set("a1", a);

    sweep(60 * MINUTE);

    expect(a.lastEventAt).toBe(7);
  });

  it("only looks on disk for an agent that's due", () => {
    appState.agents.set("a1", agent());
    const transcriptExists = vi.fn(() => true);

    sweep(MINUTE, { transcriptExists });
    expect(transcriptExists).not.toHaveBeenCalled();

    sweep(60 * MINUTE, { transcriptExists });
    expect(transcriptExists).toHaveBeenCalledWith(
      "/worktree",
      "conversation-1",
    );
  });

  it("runs every minute between start and stop", async () => {
    vi.useFakeTimers();
    appState.agents.set("a1", agent());
    const pause = vi.fn(async () => undefined);
    startIdlePause({
      checks: checks(),
      now: () => 60 * MINUTE,
      pause,
      timeoutMinutes: () => 60,
    });

    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(pause).toHaveBeenCalledTimes(1);

    stopIdlePause();
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS * 3);
    expect(pause).toHaveBeenCalledTimes(1);
  });
});
