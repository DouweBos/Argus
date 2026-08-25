/**
 * Approve/Deny clicks that arrived before the gateway was up.
 *
 * A service-worker notification can be actioned with no tab open, so the answer
 * is parked here and replayed once the page reconnects.
 */

const KEY = "argus.permission.pending";
/** An answer to a prompt nobody is waiting on anymore is worse than none. */
const MAX_AGE_MS = 30 * 60 * 1000;
const MAX_QUEUED = 10;

export interface PendingDecision {
  agentId: string;
  toolUseId: string;
  decision: "allow" | "deny";
  at: number;
}

function key(d: Pick<PendingDecision, "agentId" | "toolUseId">): string {
  return `${d.agentId}:${d.toolUseId}`;
}

export function readPendingDecisions(now: number): PendingDecision[] {
  try {
    const raw = localStorage.getItem(KEY);
    const all = raw ? (JSON.parse(raw) as PendingDecision[]) : [];

    return all.filter((d) => now - d.at < MAX_AGE_MS);
  } catch {
    return [];
  }
}

function write(decisions: PendingDecision[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(decisions));
  } catch {
    // Storage unavailable (private mode) — the answer is simply not queued.
  }
}

/** Queue an answer, replacing any earlier one for the same prompt. */
export function queuePendingDecision(decision: PendingDecision): void {
  const existing = readPendingDecisions(decision.at);
  write(
    [...existing.filter((d) => key(d) !== key(decision)), decision].slice(
      -MAX_QUEUED,
    ),
  );
}

export function clearPendingDecision(decision: PendingDecision): void {
  write(readPendingDecisions(Date.now()).filter((d) => key(d) !== key(decision)));
}
