/**
 * Auto-continue for agents stalled on a spent plan limit.
 *
 * When a project sets `auto_continue_on_limit`, a turn that ends on a usage
 * limit schedules a "continue" for the moment the CLI says the limit resets.
 * Another send, a stop or an exit cancels it; dismissing it holds off until a
 * turn gets through, since a send while limited would only re-arm it.
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
  /** The last turn ended on the limit and none has got through since. */
  stalled: boolean;
  /** Continues sent since the last turn that got through. */
  attempts: number;
  /** The user turned it off for this stall. */
  dismissed: boolean;
  dueAt: number | null;
  timer: NodeJS.Timeout | null;
  /** Ends the stall once the reported reset passes, even with no turn since. */
  expiry: NodeJS.Timeout | null;
  send: ((message: string) => void) | null;
}

const states = new Map<string, LimitState>();

function stateFor(agentId: string): LimitState {
  let state = states.get(agentId);
  if (!state) {
    state = {
      resetsAt: null,
      limitHit: false,
      stalled: false,
      attempts: 0,
      dismissed: false,
      dueAt: null,
      timer: null,
      expiry: null,
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

/** Unix ms a continue is scheduled for, or null when none is pending. */
export function limitResumeAt(agentId: string): number | null {
  return states.get(agentId)?.dueAt ?? null;
}

function announce(agentId: string): void {
  emitHostEvent(`agent:limit-resume:${agentId}`, limitResumeAt(agentId));
}

/** The agent's last turn ended on a spent limit and none has got through since. */
export function isLimitStalled(agentId: string): boolean {
  return states.get(agentId)?.stalled === true;
}

function setStalled(agentId: string, state: LimitState, stalled: boolean) {
  if (!stalled && state.expiry) {
    clearTimeout(state.expiry);
    state.expiry = null;
  }
  if (state.stalled !== stalled) {
    state.stalled = stalled;
    emitHostEvent(`agent:limit-stall:${agentId}`, stalled);
  }
}

/**
 * Called on every `result`: schedule a continue if the turn hit the limit.
 * True when this result started a stall.
 */
export function onTurnResult(
  agentId: string,
  send: (message: string) => void,
): boolean {
  const state = states.get(agentId);
  if (!state?.limitHit) {
    if (state) {
      state.attempts = 0;
      state.dismissed = false;
      state.resetsAt = null;
      setStalled(agentId, state, false);
    }

    return false;
  }
  state.limitHit = false;
  const started = !state.stalled;
  setStalled(agentId, state, true);
  armExpiry(agentId, state);
  scheduleContinue(agentId, state, send);

  return started;
}

function armExpiry(agentId: string, state: LimitState): void {
  if (state.expiry) {
    clearTimeout(state.expiry);
    state.expiry = null;
  }
  const at = state.resetsAt;
  if (at === null || at <= Date.now()) {
    return;
  }
  const check = () => {
    state.expiry = null;
    if (Date.now() < at) {
      state.expiry = setTimeout(check, Math.min(at - Date.now(), POLL_MS));
      state.expiry.unref?.();

      return;
    }
    setStalled(agentId, state, false);
  };
  check();
}

/** The account's plan has room again, so the stall is over without a turn. */
export function endLimitStall(agentId: string): void {
  const state = states.get(agentId);
  if (state) {
    setStalled(agentId, state, false);
  }
}

function scheduleContinue(
  agentId: string,
  state: LimitState,
  send: (message: string) => void,
): void {
  if (state.dismissed || !autoContinueEnabled(agentId)) {
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
  announce(agentId);
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
      announce(agentId);
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
  announce(agentId);
  telemetryCapture("agent_limit_auto_continue", {
    action: "cancelled",
    has_reset_time: state.resetsAt !== null,
  });
}

/** The user cancelled the pending continue from a client. */
export function dismissLimitResume(agentId: string): void {
  const state = states.get(agentId);
  if (!state) {
    return;
  }
  state.dismissed = true;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  if (state.dueAt !== null) {
    state.dueAt = null;
    announce(agentId);
    telemetryCapture("agent_limit_auto_continue", {
      action: "dismissed",
      has_reset_time: state.resetsAt !== null,
    });
  }
}

/** The agent stopped or exited. */
export function forgetLimitResume(agentId: string): void {
  const state = states.get(agentId);
  if (state?.timer) {
    clearTimeout(state.timer);
  }
  if (state?.expiry) {
    clearTimeout(state.expiry);
  }
  states.delete(agentId);
  if (state?.dueAt != null) {
    announce(agentId);
  }
  if (state?.stalled) {
    emitHostEvent(`agent:limit-stall:${agentId}`, false);
  }
}
