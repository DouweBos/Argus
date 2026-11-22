/** Which transition each agent is in, and the sends waiting on it. */

import type { AgentSession } from "./models";
import type { LlmRunnerHandle } from "../llm/runners/types";

export type TransitionKind = "pausing" | "respawning" | "restoring" | "waking";

export interface Transition {
  readonly kind: TransitionKind;
  /** Resolves once the lock is released, whichever way it went. */
  readonly settled: Promise<void>;
  /** A stop, delete, quit or rewind overtook it. */
  cancelled: boolean;
  /** It gave up, so a child it was still spawning mustn't take the slot. */
  abandoned: boolean;
}

export interface HeldSend {
  text: string;
  images?: { data: string; media_type: string }[];
  steer?: boolean;
  /** What its bubble shows, should it go back to the queue. */
  displayText?: string;
  author?: string;
}

const transitions = new Map<string, Transition>();
const held = new Map<string, HeldSend[]>();
/** Handles Argus killed on purpose: their exit says nothing about the agent. */
const retired = new WeakSet<LlmRunnerHandle>();

export function transitionOf(agentId: string): Transition | null {
  return transitions.get(agentId) ?? null;
}

/**
 * Run `work` as the agent's transition, after any under way. With none, the
 * lock is taken before this returns, so a send that follows already sees it.
 */
export async function withTransition<T>(
  agentId: string,
  kind: TransitionKind,
  work: (transition: Transition) => Promise<T>,
): Promise<T> {
  for (let t = transitions.get(agentId); t; t = transitions.get(agentId)) {
    await t.settled;
  }
  let settle: () => void = () => {};
  const transition: Transition = {
    kind,
    settled: new Promise<void>((resolve) => (settle = resolve)),
    cancelled: false,
    abandoned: false,
  };
  transitions.set(agentId, transition);
  try {
    return await work(transition);
  } finally {
    releaseTransition(agentId, transition);
    settle();
  }
}

export function releaseTransition(agentId: string, t: Transition): void {
  if (transitions.get(agentId) === t) {
    transitions.delete(agentId);
  }
}

export function cancelTransition(agentId: string): void {
  const transition = transitions.get(agentId);
  if (transition) {
    transition.cancelled = true;
  }
  held.delete(agentId);
}

/** The host is going down: nothing under way may register a child any more. */
export function cancelAllTransitions(): Promise<unknown> {
  const pending = [...transitions.values()];
  for (const transition of pending) {
    transition.cancelled = true;
  }
  held.clear();

  return Promise.all(pending.map((t) => t.settled));
}

export function isWaking(agentId: string): boolean {
  const transition = transitions.get(agentId);

  return transition?.kind === "waking" && !transition.cancelled;
}

export function markRetired(handle: LlmRunnerHandle): void {
  retired.add(handle);
}

export function isRetired(handle: LlmRunnerHandle): boolean {
  return retired.has(handle);
}

export function addHeldSend(agentId: string, send: HeldSend): void {
  const sends = held.get(agentId);
  if (sends) {
    sends.push(send);
  } else {
    held.set(agentId, [send]);
  }
}

export function hasHeldSends(agentId: string): boolean {
  return (held.get(agentId)?.length ?? 0) > 0;
}

export function heldSends(agentId: string): HeldSend[] {
  return held.get(agentId) ?? [];
}

export function takeHeldSends(agentId: string): HeldSend[] {
  const sends = heldSends(agentId);
  held.delete(agentId);

  return sends;
}

/** What clients show as paused: no process, and none on the way. */
export function showsPaused(agent: AgentSession): boolean {
  if (!agent.paused || hasHeldSends(agent.agentId)) {
    return false;
  }
  const kind = transitions.get(agent.agentId)?.kind;

  return !kind || kind === "pausing";
}
