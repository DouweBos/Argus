/**
 * Warm spares: per session, one live CLI already past initialize, so starting
 * an agent there is instant. Spares live here and never in `appState.agents`,
 * so no list, tool, watcher or client can see, message or stop one; a start
 * takes it in one synchronous step.
 */

import type { AgentSession } from "./models";
import { warn } from "@argus/host/logger";

export type SpareDiscardReason =
  | "account"
  | "config"
  | "evicted"
  | "exited"
  | "idle"
  | "runner"
  | "session";

/** A freshly spawned spare and the stamp of the config it read. */
export interface NewSpare {
  agent: AgentSession;
  configStamp: string;
}

export interface Spare extends NewSpare {
  sessionId: string;
  spawnedAt: number;
}

/** What a start needs a spare to match. */
export interface SpareRequest {
  runnerId: string;
  accountId: string;
  configStamp: string;
}

export type SpareEvent =
  | { type: "discarded"; sessionId: string; reason: SpareDiscardReason }
  | { type: "failed"; sessionId: string; error: string }
  | { type: "ready"; sessionId: string }
  | { type: "taken"; sessionId: string };

const pool = new Map<string, Spare>();
/** In-flight spawns by ticket; a discard drops the ticket, so its spare is killed on arrival. */
const filling = new Map<string, object>();
const listeners = new Set<(event: SpareEvent) => void>();

export function onSpareEvent(
  listener: (event: SpareEvent) => void,
): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

function notify(event: SpareEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (e) {
      warn(`[spares] listener failed: ${String(e)}`);
    }
  }
}

export function hasSpare(sessionId: string): boolean {
  return pool.has(sessionId);
}

export function getSpare(sessionId: string): Spare | null {
  return pool.get(sessionId) ?? null;
}

export function isFilling(sessionId: string): boolean {
  return filling.has(sessionId);
}

export function spareSessionIds(): string[] {
  return [...pool.keys()];
}

export function killSpare(agent: AgentSession): void {
  agent.handle
    .kill()
    .then(() => agent.handle.cleanup())
    .catch((e: unknown) => {
      warn(`[spares] killing ${agent.agentId} failed: ${String(e)}`);
    });
}

function mismatch(spare: Spare, req: SpareRequest): SpareDiscardReason | null {
  if (spare.agent.runner.id !== req.runnerId) {
    return "runner";
  }
  if (spare.agent.accountId !== req.accountId) {
    return "account";
  }
  if (spare.configStamp !== req.configStamp) {
    return "config";
  }

  return null;
}

/**
 * Hand the session's spare to a start, or null when there is none or it no
 * longer matches what the start resolved to (that one is discarded).
 */
export function takeSpare(
  sessionId: string,
  req: SpareRequest,
): AgentSession | null {
  const spare = pool.get(sessionId);
  if (!spare) {
    return null;
  }
  const stale = mismatch(spare, req);
  if (stale) {
    discardSpare(sessionId, stale);

    return null;
  }
  pool.delete(sessionId);
  notify({ type: "taken", sessionId });

  return spare.agent;
}

/**
 * Spawn a spare for the session unless it has one or one is on its way.
 * A discard while the spawn runs drops it on arrival.
 */
export async function fillSpare(
  sessionId: string,
  spawn: () => Promise<NewSpare>,
): Promise<void> {
  if (pool.has(sessionId) || filling.has(sessionId)) {
    return;
  }
  const ticket = {};
  filling.set(sessionId, ticket);
  let spawned: NewSpare;
  try {
    spawned = await spawn();
  } catch (e) {
    if (filling.get(sessionId) === ticket) {
      filling.delete(sessionId);
      notify({ type: "failed", sessionId, error: String(e) });
    }

    return;
  }
  if (filling.get(sessionId) !== ticket) {
    killSpare(spawned.agent);

    return;
  }
  filling.delete(sessionId);
  const spare: Spare = { ...spawned, sessionId, spawnedAt: Date.now() };
  pool.set(sessionId, spare);
  spawned.agent.handle.on("exit", () => {
    if (pool.get(sessionId) === spare) {
      pool.delete(sessionId);
      notify({ type: "discarded", sessionId, reason: "exited" });
    }
  });
  notify({ type: "ready", sessionId });
}

/** Drop the session's spare, and any spawn on its way, killing the CLI. */
export function discardSpare(
  sessionId: string,
  reason: SpareDiscardReason,
): void {
  filling.delete(sessionId);
  const spare = pool.get(sessionId);
  if (!spare) {
    return;
  }
  pool.delete(sessionId);
  killSpare(spare.agent);
  notify({ type: "discarded", sessionId, reason });
}

/** Kill every spare without announcing it — the host is going down. */
export function clearSpares(): void {
  filling.clear();
  for (const spare of pool.values()) {
    killSpare(spare.agent);
  }
  pool.clear();
}
