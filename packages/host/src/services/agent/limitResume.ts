/**
 * Auto-continue for agents stalled on a spent plan limit.
 *
 * When a project sets `auto_continue_on_limit`, a turn that ends on a usage
 * limit schedules a "continue" for the moment the CLI says the limit resets.
 * Any other send, a stop or an exit cancels it.
 */

import { emitHostEvent } from "@argus/host/bus";
import { info, warn } from "@argus/host/logger";
import { appState } from "../../state";
import { loadArgusConfig } from "../session/argusConfig";
import { capture as telemetryCapture } from "../telemetry/telemetry";

export const CONTINUE_MESSAGE = "continue";

/** Margin after the reported reset, so the first request isn't refused again. */
const RESET_MARGIN_MS = 60_000;
/** Used when the CLI never reported a reset time. */
const FALLBACK_DELAY_MS = 60 * 60_000;
/** Re-check cadence: macOS pauses timers during sleep, so long ones fire late. */
const POLL_MS = 60_000;
/** Consecutive continues that hit the limit again before giving up. */
const MAX_ATTEMPTS = 5;

interface LimitState {
  /** Unix ms the CLI says the spent window resets, when it said so. */
  resetsAt: number | null;
  /** This turn ended on the limit. */
  limitHit: boolean;
  /** Continues sent since the last turn that got through. */
  attempts: number;
  dueAt: number | null;
  timer: NodeJS.Timeout | null;
  send: ((message: string) => void) | null;
}

const states = new Map<string, LimitState>();

function stateFor(agentId: string): LimitState {
  let state = states.get(agentId);
  if (!state) {
    state = {
      resetsAt: null,
      limitHit: false,
      attempts: 0,
      dueAt: null,
      timer: null,
      send: null,
    };
    states.set(agentId, state);
  }

  return state;
}

/** Track the CLI's `rate_limit_event`, which carries the reset time. */
export function noteRateLimitLine(agentId: string, line: string): void {
  let msg: {
    type?: unknown;
    rate_limit_info?: { status?: unknown; resetsAt?: unknown };
  };
  try {
    msg = JSON.parse(line) as typeof msg;
  } catch {
    return;
  }
  if (msg.type !== "rate_limit_event") {
    return;
  }
  const { status, resetsAt } = msg.rate_limit_info ?? {};
  if (status === "rejected" && typeof resetsAt === "number") {
    stateFor(agentId).resetsAt = resetsAt * 1000;
  }
}

/** The current turn was refused because the plan limit is spent. */
export function noteLimitHit(agentId: string): void {
  stateFor(agentId).limitHit = true;
}

function autoContinueEnabled(agentId: string): boolean {
  const agent = appState.agents.get(agentId);
  const repoRoot = agent && appState.sessions.get(agent.sessionId)?.repo_root;
  if (!repoRoot) {
    return false;
  }
  try {
    return loadArgusConfig(repoRoot).auto_continue_on_limit === true;
  } catch {
    return false;
  }
}

/** Called on every `result`: schedule a continue if the turn hit the limit. */
export function onTurnResult(
  agentId: string,
  send: (message: string) => void,
): void {
  const state = states.get(agentId);
  if (!state?.limitHit) {
    if (state) {
      state.attempts = 0;
    }

    return;
  }
  state.limitHit = false;

  if (!autoContinueEnabled(agentId)) {
    return;
  }
  if (state.attempts >= MAX_ATTEMPTS) {
    warn(`[agent:${agentId}] still limited after ${state.attempts} continues`);
    telemetryCapture("agent_limit_auto_continue", {
      action: "gave_up",
      has_reset_time: state.resetsAt !== null,
    });

    return;
  }

  state.send = send;
  const now = Date.now();
  const hasResetTime = state.resetsAt !== null && state.resetsAt > now;
  state.dueAt = hasResetTime
    ? (state.resetsAt as number) + RESET_MARGIN_MS
    : now + FALLBACK_DELAY_MS;
  info(
    `[agent:${agentId}] plan limit hit, continuing at ${new Date(state.dueAt).toISOString()}`,
  );
  telemetryCapture("agent_limit_auto_continue", {
    action: "scheduled",
    has_reset_time: hasResetTime,
  });
  arm(agentId, state);
}

function arm(agentId: string, state: LimitState): void {
  if (state.timer) {
    clearTimeout(state.timer);
  }
  const wait = Math.max(0, (state.dueAt ?? 0) - Date.now());
  state.timer = setTimeout(
    () => {
      state.timer = null;
      if (state.dueAt === null) {
        return;
      }
      if (Date.now() < state.dueAt) {
        arm(agentId, state);

        return;
      }
      state.dueAt = null;
      fire(agentId, state);
    },
    Math.min(wait, POLL_MS),
  );
  state.timer.unref?.();
}

function fire(agentId: string, state: LimitState): void {
  const agent = appState.agents.get(agentId);
  // Someone already got it going, or it went away.
  if (
    !state.send ||
    !agent ||
    agent.status !== "idle" ||
    !autoContinueEnabled(agentId)
  ) {
    return;
  }
  const hasResetTime = state.resetsAt !== null;
  state.attempts += 1;
  state.resetsAt = null;
  try {
    state.send(CONTINUE_MESSAGE);
  } catch (e) {
    warn(`[agent:${agentId}] auto-continue failed: ${String(e)}`);

    return;
  }
  // The renderer only draws user bubbles for sends it made itself.
  emitHostEvent(`agent:remote-message:${agentId}`, {
    message: CONTINUE_MESSAGE,
    author: "Argus",
  });
  info(`[agent:${agentId}] auto-continued after plan limit reset`);
  telemetryCapture("agent_limit_auto_continue", {
    action: "sent",
    has_reset_time: hasResetTime,
  });
}

/** Any other send supersedes a pending continue. */
export function cancelLimitResume(agentId: string): void {
  const state = states.get(agentId);
  if (!state?.timer) {
    return;
  }
  clearTimeout(state.timer);
  state.timer = null;
  state.dueAt = null;
  telemetryCapture("agent_limit_auto_continue", {
    action: "cancelled",
    has_reset_time: state.resetsAt !== null,
  });
}

/** The agent stopped or exited. */
export function forgetLimitResume(agentId: string): void {
  const state = states.get(agentId);
  if (state?.timer) {
    clearTimeout(state.timer);
  }
  states.delete(agentId);
}
