/**
 * Replacing an agent's child under the same id. One lock per agent says which
 * transition is under way; spawning is injected, so the agent service can
 * import this without a cycle.
 */

import type { AgentSession, AgentStatusValue } from "./models";
import type { LlmRunnerHandle } from "../llm/runners/types";
import { emitHostEvent } from "@argus/host/bus";
import { warn } from "@argus/host/logger";
import { appState } from "../../state";

export type TransitionKind = "respawning" | "restoring";

export interface LifecycleDeps {
  /** Start a new child in the slot, resuming `resumeRef` when given. */
  respawn: (session: AgentSession, resumeRef?: string) => Promise<unknown>;
  emitStatus: (agentId: string, status: AgentStatusValue) => void;
}

interface Transition {
  kind: TransitionKind;
  /** Rejects when the transition failed. */
  done: Promise<unknown>;
}

const transitions = new Map<string, Transition>();
/** Handles Argus killed on purpose: their exit says nothing about the agent. */
const retired = new WeakSet<LlmRunnerHandle>();
let bound: LifecycleDeps | null = null;

export function bindLifecycle(injected: LifecycleDeps): void {
  bound = injected;
}

function deps(): LifecycleDeps {
  if (!bound) {
    throw "The agent lifecycle isn't bound yet";
  }

  return bound;
}

export function isRetired(handle: LlmRunnerHandle): boolean {
  return retired.has(handle);
}

/** Run `work` as the agent's transition. The lock is taken before this returns. */
export async function withTransition<T>(
  agentId: string,
  kind: TransitionKind,
  work: () => Promise<T>,
): Promise<T> {
  const done = work();
  const transition = { kind, done };
  transitions.set(agentId, transition);
  try {
    return await done;
  } finally {
    if (transitions.get(agentId) === transition) {
      transitions.delete(agentId);
    }
  }
}

/** A respawn under way; messages for the agent wait for the new child. */
export function pendingRespawn(agentId: string): Promise<unknown> | null {
  const transition = transitions.get(agentId);

  return transition?.kind === "respawning" ? transition.done : null;
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
  retired.add(handle);
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
  retired.add(handle);
  handle
    .kill()
    .then(() => handle.cleanup())
    .catch((e: unknown) => {
      warn(`[agent:${agentId}] killing a failed respawn: ${String(e)}`);
    });
  slot.status = "error";
  slot.suppressStatus = false;
  for (const resolve of slot.turnWaiters) {
    resolve("error");
  }
  slot.turnWaiters.length = 0;
  slot.exitWaiters.length = 0;
  deps().emitStatus(agentId, "error");
}

/**
 * Restart an agent in place so it picks up new spawn-time settings — a runner
 * or Claude account switch. The agent id is reused so the tab and conversation
 * slot survive the swap, and the runner already stamped on the slot is what
 * the new subprocess spawns under. `keepModel` holds on to the model, which
 * only a runner switch invalidates; `resumeRef` carries the conversation over.
 */
export async function respawnAgent(
  agentId: string,
  opts: { keepModel?: boolean; resumeRef?: string } = {},
): Promise<void> {
  const session = appState.agents.get(agentId);
  if (!session) {
    return;
  }

  // Silence the kill → spawn status flicker in the UI.
  session.suppressStatus = true;
  if (!opts.keepModel) {
    // The old runner's model id means nothing to the new one; drop it so the
    // spawn cascade falls through to the runner default.
    session.model = null;
  }

  try {
    await withTransition(agentId, "respawning", async () => {
      await retireChild(agentId, session.handle);
      await deps().respawn(session, opts.resumeRef);
    });
  } catch (e) {
    failRespawn(agentId);
    throw e;
  } finally {
    const fresh = appState.agents.get(agentId);
    if (fresh) {
      fresh.suppressStatus = false;
    }
  }
}
