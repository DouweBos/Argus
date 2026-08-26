/**
 * Approve/Deny taps that arrived while we were offline.
 *
 * A notification button can be pressed with the app killed — and this app is
 * behind a biometric lock, so the answer often can't be sent for a while.
 * Persist the intent and replay it once the gateway is back.
 */

import { readJson, writeJson } from "./storage";

const KEY = "permission.pending";
/** An answer to a prompt nobody is waiting on anymore is worse than none. */
const MAX_AGE_MS = 30 * 60 * 1000;
const MAX_QUEUED = 10;

export interface PendingDecision {
  agentId: string;
  /** The computer that owns this agent; only it can accept the answer. */
  hostId: string | null;
  toolUseId: string;
  decision: "allow" | "deny";
  at: number;
}

function key(d: Pick<PendingDecision, "agentId" | "toolUseId">): string {
  return `${d.agentId}:${d.toolUseId}`;
}

export async function readPendingDecisions(
  now: number,
  hostId?: string,
): Promise<PendingDecision[]> {
  const all = await readJson<PendingDecision[]>(KEY, []);
  const fresh = all.filter((d) => now - d.at < MAX_AGE_MS);

  // An answer for another computer waits until that one is connected again.
  return hostId
    ? fresh.filter((d) => d.hostId == null || d.hostId === hostId)
    : fresh;
}

/** Queue an answer, replacing any earlier one for the same prompt. */
export async function queuePendingDecision(
  decision: PendingDecision,
): Promise<void> {
  const existing = await readPendingDecisions(decision.at);
  const next = [
    ...existing.filter((d) => key(d) !== key(decision)),
    decision,
  ].slice(-MAX_QUEUED);
  await writeJson(KEY, next);
}

export async function clearPendingDecision(
  decision: PendingDecision,
): Promise<void> {
  const existing = await readPendingDecisions(Date.now());
  await writeJson(
    KEY,
    existing.filter((d) => key(d) !== key(decision)),
  );
}
