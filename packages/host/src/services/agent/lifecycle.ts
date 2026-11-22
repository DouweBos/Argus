/**
 * An agent's process apart from the agent: pausing, waking and replacing it
 * under the same id. Spawning is injected, so the agent service can import
 * this without a cycle.
 */

import type { HeldSend, Transition } from "./lifecycleState";
import type { AgentSession, AgentStatusValue } from "./models";
import type { EventMap } from "../../telemetryEvents";
import type { LlmRunnerHandle } from "../llm/runners/types";
import { emitHostEvent } from "@argus/host/bus";
import { info, warn } from "@argus/host/logger";
import { appState } from "../../state";
import { capture } from "../telemetry/telemetry";
import { isAgentBusy } from "./busy";
import {
  addHeldSend,
  cancelTransition,
  hasHeldSends,
  heldSends,
  isRetired,
  markRetired,
  releaseTransition,
  showsPaused,
  takeHeldSends,
  transitionOf,
  withTransition,
} from "./lifecycleState";
import { requeueUndelivered } from "./messageQueue";
import { settleTurnWaiters } from "./waiters";

export type WakeTrigger = EventMap["agent_woken"]["trigger"];

/** How long a wake's spawn and handshake may take. */
export const WAKE_TIMEOUT_MS = 60_000;

export interface LifecycleDeps {
  /** Start a new child in the slot, resuming `resumeRef` when given. */
  respawn: (session: AgentSession, resumeRef?: string) => Promise<unknown>;
  /**
   * Spawn exactly what was paused and put it in the slot, unless `mayRegister`
   * says the slot has moved on; that child is killed instead.
   */
  wake: (
    paused: AgentSession,
    mayRegister: () => boolean,
  ) => Promise<AgentSession>;
  /** Put a new child on the effort the agent had. */
  restoreEffort: (agent: AgentSession) => Promise<void>;
  /** Ask the child what can't be asked of a paused one. */
  beforePause: (agent: AgentSession) => Promise<void>;
  write: (agentId: string, send: HeldSend) => void;
  /** The devices an exit would have let go. */
  release: (agentId: string) => void;
  setInflight: (agentId: string, inflight: boolean) => void;
  emitStatus: (agentId: string, status: AgentStatusValue) => void;
}

let bound: LifecycleDeps | null = null;
const wakes = new Map<string, Promise<void>>();

export function bindLifecycle(injected: LifecycleDeps): void {
  bound = injected;
}

function deps(): LifecycleDeps {
  if (!bound) {
    throw "The agent lifecycle isn't bound yet";
  }

  return bound;
}

function announcePaused(agent: AgentSession): void {
  emitHostEvent(`agent:paused:${agent.agentId}`, showsPaused(agent));
}

/** The process that asked is gone, so its prompts can't be answered any more. */
export function dropPendingPrompts(agentId: string): void {
  const pending = appState.agentPendingPermissions.get(agentId);
  appState.agentPendingPermissions.delete(agentId);
  for (const toolUseId of pending?.keys() ?? []) {
    emitHostEvent(`agent:permission-cancel:${agentId}`, {
      tool_use_id: toolUseId,
    });
  }
}

/** Kill a child Argus is replacing; from here on nothing it says counts. */
export async function retireChild(
  agentId: string,
  handle: LlmRunnerHandle,
): Promise<void> {
  markRetired(handle);
  await handle.kill();
  handle.cleanup();
  dropPendingPrompts(agentId);
}

/** A respawn failed with the old child gone: whatever holds the slot is dead. */
export function failRespawn(agentId: string): void {
  const slot = appState.agents.get(agentId);
  if (!slot) {
    return;
  }
  const { handle } = slot;
  markRetired(handle);
  handle
    .kill()
    .then(() => handle.cleanup())
    .catch((e: unknown) => {
      warn(`[agent:${agentId}] killing a failed respawn: ${String(e)}`);
    });
  slot.status = "error";
  slot.suppressStatus = false;
  settleTurnWaiters(slot, "error");
  if (slot.exitWaiters) {
    slot.exitWaiters.length = 0;
  }
  if (slot.paused) {
    slot.paused = false;
    announcePaused(slot);
  }
  deps().emitStatus(agentId, "error");
}

/**
 * Restart an agent in place so it picks up new spawn-time settings — a runner
 * or Claude account switch. The agent id is reused so the tab and conversation
 * slot survive the swap, and the runner already stamped on the slot is what
 * the new subprocess spawns under. `keepModel` holds on to the model and
 * effort, which only a runner switch invalidates; `resumeRef` carries the
 * conversation over.
 */
export async function respawnAgent(
  agentId: string,
  opts: { keepModel?: boolean; resumeRef?: string } = {},
): Promise<void> {
  if (!appState.agents.has(agentId)) {
    return;
  }
  await withTransition(agentId, "respawning", async () => {
    const session = appState.agents.get(agentId);
    if (!session) {
      return;
    }
    if (session.paused) {
      announcePaused(session);
    }
    // Silence the kill → spawn status flicker in the UI.
    session.suppressStatus = true;
    if (!opts.keepModel) {
      // The old runner's model and effort mean nothing to the new one; drop
      // them so the spawn cascade falls through to the runner default.
      session.model = null;
      session.resolvedModel = null;
      session.effort = null;
    }
    try {
      await retireChild(agentId, session.handle);
      await deps().respawn(session, opts.resumeRef);
    } catch (e) {
      failRespawn(agentId);
      throw e;
    } finally {
      const fresh = appState.agents.get(agentId);
      if (fresh) {
        fresh.suppressStatus = false;
      }
    }
  });
}

/**
 * Let the agent's process exit and keep the agent. Nothing else about it
 * changes: no status, no activity stamp, no queue drain.
 */
export async function pauseAgent(
  agentId: string,
  idleMs: number,
): Promise<void> {
  await withTransition(agentId, "pausing", async (transition) => {
    const agent = appState.agents.get(agentId);
    if (!agent || agent.paused) {
      return;
    }
    agent.paused = true;
    announcePaused(agent);
    await deps()
      .beforePause(agent)
      .catch(() => undefined);
    if (
      transition.cancelled ||
      agent.status !== "idle" ||
      hasHeldSends(agentId) ||
      (agent.background?.tasks ?? 0) > 0 ||
      isAgentBusy(agent)
    ) {
      keepRunning(agent, transition);

      return;
    }
    await retireChild(agentId, agent.handle);
    if (transition.cancelled) {
      return;
    }
    capture("agent_paused", {
      had_turns: agent.turnsCompleted > 0 || agent.resumed === true,
      idle_bucket: idleBucket(idleMs),
    });
    info(`[agent:${agentId}] paused`);
  });
  if (hasHeldSends(agentId) && appState.agents.get(agentId)?.paused) {
    await ensureAwake(agentId, "message").catch((e: unknown) => {
      warn(`[agent:${agentId}] waking for a message failed: ${String(e)}`);
    });
  }
}

/** Something happened before the kill, so the child it happened to stays. */
function keepRunning(agent: AgentSession, transition: Transition): void {
  const { agentId } = agent;
  agent.paused = false;
  agent.idleSince = Date.now();
  announcePaused(agent);
  releaseTransition(agentId, transition);
  if (agent.status === "stopped" || agent.status === "error") {
    takeHeldSends(agentId);

    return;
  }
  for (const send of takeHeldSends(agentId)) {
    try {
      deps().write(agentId, send);
    } catch (e) {
      warn(`[agent:${agentId}] held message not sent: ${String(e)}`);
    }
  }
}

/**
 * Take a send for an agent with no process to write to. It's running and in
 * flight from here, so nobody waiting on it reads its previous turn's result.
 */
export function holdSend(agent: AgentSession, send: HeldSend): void {
  const { agentId } = agent;
  addHeldSend(agentId, send);
  deps().setInflight(agentId, true);
  announcePaused(agent);
  if (agent.status !== "running") {
    agent.status = "running";
    deps().emitStatus(agentId, "running");
  }
  // A pause under way picks it up as it ends.
  if (transitionOf(agentId)?.kind !== "pausing") {
    ensureAwake(agentId, "message").catch((e: unknown) => {
      warn(`[agent:${agentId}] waking for a message failed: ${String(e)}`);
    });
  }
}

/**
 * Whether acting on the agent waits for a process first. Ask before awaiting
 * `ensureAwake`, so a change to a live agent keeps its place ahead of a send.
 */
export function needsWake(agentId: string): boolean {
  return (
    appState.agents.get(agentId)?.paused === true ||
    transitionOf(agentId) !== null
  );
}

/**
 * Resolves once the agent has a process to act on, waking a paused one. Any
 * number of callers share one wake, and its failure.
 */
export async function ensureAwake(
  agentId: string,
  trigger: WakeTrigger,
): Promise<void> {
  const underWay = wakes.get(agentId);
  if (underWay) {
    return underWay;
  }
  const transition = transitionOf(agentId);
  if (transition) {
    await transition.settled;

    return ensureAwake(agentId, trigger);
  }
  const agent = appState.agents.get(agentId);
  if (!agent) {
    throw `No agent found: ${agentId}`;
  }
  agent.idleSince = Date.now();
  if (!agent.paused) {
    return;
  }
  const waking = wake(agentId, trigger);
  wakes.set(agentId, waking);
  try {
    await waking;
  } finally {
    wakes.delete(agentId);
  }
}

async function wake(agentId: string, trigger: WakeTrigger): Promise<void> {
  await withTransition(agentId, "waking", async (transition) => {
    const paused = appState.agents.get(agentId);
    if (!paused?.paused) {
      return;
    }
    const startedAt = Date.now();
    const report = (success: boolean): void =>
      capture("agent_woken", {
        trigger,
        success,
        duration_bucket: durationBucket(Date.now() - startedAt),
      });
    announcePaused(paused);
    const mayRegister = (): boolean =>
      !transition.cancelled &&
      !transition.abandoned &&
      appState.agents.get(agentId) === paused;

    let fresh: AgentSession | null = null;
    const start = async (): Promise<AgentSession> => {
      const agent = await deps().wake(paused, mayRegister);
      fresh = agent;
      await agent.handle.waitForInit();
      await deps().restoreEffort(agent);

      return agent;
    };
    try {
      const agent = await withTimeout(start(), WAKE_TIMEOUT_MS);
      if (transition.cancelled || appState.agents.get(agentId) !== agent) {
        throw "The agent was stopped while it was resuming";
      }
      if (isRetired(agent.handle)) {
        throw "Its process exited while starting";
      }
      const sends = heldSends(agentId);
      while (sends.length > 0) {
        deps().write(agentId, sends[0]!);
        sends.shift();
      }
      takeHeldSends(agentId);
      releaseTransition(agentId, transition);
      agent.idleSince = Date.now();
      report(true);
      info(`[agent:${agentId}] woken`);
    } catch (e) {
      transition.abandoned = true;
      await putBackPaused(paused, fresh);
      // Overtaken, not failed: whoever cancelled decides what happens next.
      if (transition.cancelled || !appState.agents.has(agentId)) {
        throw e;
      }
      const reason = e instanceof Error ? e.message : String(e);
      releaseTransition(agentId, transition);
      report(false);
      emitHostEvent(`agent:wake-failed:${agentId}`, {
        reason,
        queued: hasHeldSends(agentId),
      });
      returnHeldSends(paused, `Couldn't resume this chat: ${reason}`);
      announcePaused(paused);
      throw `Couldn't resume this chat: ${reason}`;
    }
  });
}

/** A wake that didn't make it leaves the slot as the pause left it. */
async function putBackPaused(
  paused: AgentSession,
  fresh: AgentSession | null,
): Promise<void> {
  if (!fresh) {
    return;
  }
  const { agentId } = paused;
  markRetired(fresh.handle);
  if (appState.agents.get(agentId) === fresh) {
    paused.status = fresh.status;
    appState.agents.set(agentId, paused);
  }
  await retireChild(agentId, fresh.handle);
}

/** Unsent messages lead the queue again, which waits for the user's next move. */
function returnHeldSends(agent: AgentSession, why: string): void {
  const { agentId } = agent;
  const sends = takeHeldSends(agentId);
  if (sends.length === 0) {
    return;
  }
  agent.status = "idle";
  agent.resultSummary = {
    subtype: "error",
    result: why,
    total_cost_usd: 0,
    duration_ms: 0,
  };
  requeueUndelivered(agentId, sends);
  deps().setInflight(agentId, false);
  announcePaused(agent);
  deps().emitStatus(agentId, "idle");
  settleTurnWaiters(agent, "idle");
}

/**
 * An interrupt with no turn to interrupt: nothing while paused, and while
 * waking the messages go back to the queue. False when the runner should get it.
 */
export function interruptWithoutTurn(agentId: string): boolean {
  const agent = appState.agents.get(agentId);
  if (!agent || (!agent.paused && transitionOf(agentId)?.kind !== "waking")) {
    return false;
  }
  returnHeldSends(agent, "Interrupted before the message was sent.");

  return true;
}

/** The agent is leaving for good, possibly with no exit to report it. */
export function abandonAgent(
  agentId: string,
  agent: AgentSession | undefined,
): void {
  cancelTransition(agentId);
  if (!agent || !(agent.paused || isRetired(agent.handle))) {
    return;
  }
  for (const resolve of agent.exitWaiters ?? []) {
    resolve(0);
  }
  if (agent.exitWaiters) {
    agent.exitWaiters.length = 0;
  }
  settleTurnWaiters(agent, "stopped");
  bound?.release(agentId);
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject("It took too long to start"), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function idleBucket(ms: number): EventMap["agent_paused"]["idle_bucket"] {
  const minutes = ms / 60_000;
  if (minutes < 30) {
    return "<30m";
  }
  if (minutes < 60) {
    return "30-60m";
  }

  return minutes < 240 ? "1-4h" : "4h+";
}

function durationBucket(
  ms: number,
): EventMap["agent_woken"]["duration_bucket"] {
  if (ms < 1000) {
    return "<1s";
  }
  if (ms < 3000) {
    return "1-3s";
  }

  return ms < 10_000 ? "3-10s" : "10s+";
}
