/**
 * Lets an inactive agent's process exit. An agent is only paused when killing
 * its CLI loses nothing a resume wouldn't bring back.
 */

import type { AgentSession } from "./models";
import type { Session } from "../session/models";
import { warn } from "@argus/host/logger";
import { appState } from "../../state";
import { loadAppSettings } from "../appSettings/store";
import { isClaudeBased } from "../llm/runners/claudeCode/family";
import { findClaudeTranscript } from "../llm/runners/claudeCode/transcriptFork";
import { hasOpenMcpCall } from "../mcp/openCalls";
import { teammateThreadForSession } from "../teammate/threadSessions";
import { isInflight } from "./conversation/folded";
import { pauseAgent } from "./lifecycle";
import { hasHeldSends, transitionOf } from "./lifecycleState";
import { limitResumeAt } from "./limitResume";
import { hasOpenMcpControl } from "./mcpControl";
import { listQueue } from "./messageQueue";

/** The prompt cache lasts an hour, so a resume after that rarely costs a warm one. */
export const DEFAULT_IDLE_TIMEOUT_MINUTES = 60;
export const SWEEP_INTERVAL_MS = 60_000;

export type PauseBlocker =
  | "automation_host"
  | "background_task"
  | "in_flight"
  | "limit_resume"
  | "mcp"
  | "no_transcript"
  | "not_running"
  | "paused"
  | "prompt"
  | "queued"
  | "runner"
  | "schedule_unknown"
  | "scheduled"
  | "session"
  | "transition"
  | "working";

export interface PauseChecks {
  inflight: (agentId: string) => boolean;
  inTransition: (agentId: string) => boolean;
  limitResumeAt: (agentId: string) => number | null;
  mcpOpen: (agentId: string) => boolean;
  pendingPrompts: (agentId: string) => number;
  queued: (agentId: string) => number;
  session: (sessionId: string) => Session | undefined;
  transcriptExists: (cwd: string, resumeRef: string) => boolean;
}

/** Why the agent mustn't be paused, or null when nothing would be lost. */
export function pauseBlocker(
  agent: AgentSession,
  checks: PauseChecks,
): PauseBlocker | null {
  const { agentId, background } = agent;
  if (agent.paused) {
    return "paused";
  }
  if (!isClaudeBased(agent.runner)) {
    return "runner";
  }
  if (agent.status === "stopped" || agent.status === "error") {
    return "not_running";
  }
  if (agent.status !== "idle" || agent.inflightPrompts > 0) {
    return "working";
  }
  if (checks.inflight(agentId)) {
    return "in_flight";
  }
  if (checks.pendingPrompts(agentId) > 0) {
    return "prompt";
  }
  if (checks.queued(agentId) > 0) {
    return "queued";
  }
  if (!background || background.scheduled === null) {
    return "schedule_unknown";
  }
  if (background.tasks > 0) {
    return "background_task";
  }
  if (background.scheduled > 0) {
    return "scheduled";
  }
  if (checks.mcpOpen(agentId)) {
    return "mcp";
  }
  if (checks.limitResumeAt(agentId) !== null) {
    return "limit_resume";
  }
  if (checks.inTransition(agentId) || agent.suppressStatus) {
    return "transition";
  }
  const session = checks.session(agent.sessionId);
  // A run's agent is stopped when the run ends; a teammate's conversation
  // is long-lived, so it pauses like any other.
  if (
    session?.kind === "automation_host" &&
    !teammateThreadForSession(session.id)
  ) {
    return "automation_host";
  }
  if (
    !session?.path ||
    session.status !== "ready" ||
    session.availability === "unavailable"
  ) {
    return "session";
  }
  if (agent.resumeRef) {
    return checks.transcriptExists(session.path, agent.resumeRef)
      ? null
      : "no_transcript";
  }

  // Used, and nothing to bring it back with.
  return agent.turnsCompleted > 0 ? "no_transcript" : null;
}

const CHECKS: PauseChecks = {
  inflight: isInflight,
  inTransition: (id) => transitionOf(id) !== null || hasHeldSends(id),
  limitResumeAt,
  mcpOpen: (id) => hasOpenMcpCall(id) || hasOpenMcpControl(id),
  pendingPrompts: (id) => appState.agentPendingPermissions.get(id)?.size ?? 0,
  queued: (id) => listQueue(id).length,
  session: (id) => appState.sessions.get(id),
  transcriptExists: (cwd, ref) => findClaudeTranscript(cwd, ref) !== null,
};

function timeoutSetting(): number {
  const value = loadAppSettings().agent_idle_timeout_minutes;

  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_IDLE_TIMEOUT_MINUTES;
}

export interface IdlePauseOptions {
  checks: PauseChecks;
  now: () => number;
  pause: (agentId: string, idleMs: number) => Promise<void>;
  /** Minutes; 0 is never. */
  timeoutMinutes: () => number;
}

const DEFAULTS: IdlePauseOptions = {
  checks: CHECKS,
  now: () => Date.now(),
  pause: pauseAgent,
  timeoutMinutes: timeoutSetting,
};

/** One pass: pause every agent that has been free of blockers for the timeout. */
export function sweepIdleAgents(
  overrides: Partial<IdlePauseOptions> = {},
): void {
  const { checks, now, pause, timeoutMinutes } = { ...DEFAULTS, ...overrides };
  const timeoutMs = timeoutMinutes() * 60_000;
  if (timeoutMs === 0) {
    return;
  }
  const at = now();
  for (const agent of [...appState.agents.values()]) {
    if (agent.paused) {
      continue;
    }
    const idleMs = at - (agent.idleSince ?? at);
    const due = idleMs >= timeoutMs;
    // The disk is only read for an agent that's due.
    const blocker = pauseBlocker(
      agent,
      due ? checks : { ...checks, transcriptExists: () => true },
    );
    if (blocker) {
      agent.idleSince = at;
      continue;
    }
    agent.idleSince ??= at;
    if (due) {
      pause(agent.agentId, idleMs).catch((e: unknown) => {
        warn(`[agent:${agent.agentId}] pause failed: ${String(e)}`);
      });
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startIdlePause(
  overrides: Partial<IdlePauseOptions> = {},
): void {
  if (timer) {
    return;
  }
  timer = setInterval(() => sweepIdleAgents(overrides), SWEEP_INTERVAL_MS);
  timer.unref?.();
}

export function stopIdlePause(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
