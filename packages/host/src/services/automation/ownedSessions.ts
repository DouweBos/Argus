/**
 * Which sessions an automation started, and therefore which ones it may touch
 * and which ones count against its concurrency.
 *
 * A proposal records the session it became, but `create_session` called
 * straight from a host agent records nothing — so the accounting and the
 * ownership checks both need their own list. It is persisted because a branch
 * an automation opened yesterday is still its branch after a restart.
 */

import { appState } from "../../state";
import { readEnvelope, writeJson } from "./jsonFile";
import { automationSessionsFilePath } from "./paths";

const SCHEMA_VERSION = 1;

export interface OwnedSession {
  automation_id: string;
  run_id: string | null;
  session_id: string;
  created_at: number;
}

let owned: OwnedSession[] | null = null;

function cache(): OwnedSession[] {
  if (!owned) {
    owned = readEnvelope<OwnedSession>(
      automationSessionsFilePath(),
      "automation-sessions.json",
      "sessions",
      SCHEMA_VERSION,
    );
  }

  return owned;
}

/** Test seam: drop the cache so the next read comes off disk again. */
export function resetOwnedSessionCache(): void {
  owned = null;
}

function persist(): void {
  writeJson(automationSessionsFilePath(), {
    version: SCHEMA_VERSION,
    sessions: cache(),
  });
}

export function listOwnedSessions(automationId?: string): OwnedSession[] {
  return cache()
    .filter((s) => !automationId || s.automation_id === automationId)
    .map((s) => ({ ...s }));
}

/** Claims older than this are dropped on the next write. */
const CLAIM_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Claim a session for an automation. Idempotent. */
export function recordAutomationSession(
  automationId: string,
  runId: string | null,
  sessionId: string,
): void {
  if (cache().some((s) => s.session_id === sessionId)) {
    return;
  }
  const cutoff = Date.now() - CLAIM_RETENTION_MS;
  owned = cache().filter((s) => s.created_at >= cutoff);
  cache().push({
    automation_id: automationId,
    run_id: runId,
    session_id: sessionId,
    created_at: Date.now(),
  });
  persist();
}

export function automationOwningSession(
  sessionId: string,
): OwnedSession | null {
  const found = cache().find((s) => s.session_id === sessionId);

  return found ? { ...found } : null;
}

/** Drop the claim — the branch merged, or the session was deleted. */
export function forgetAutomationSession(sessionId: string): void {
  const list = cache();
  const index = list.findIndex((s) => s.session_id === sessionId);
  if (index === -1) {
    return;
  }
  list.splice(index, 1);
  persist();
}

export function forgetAutomationSessions(automationId: string): void {
  const remaining = cache().filter((s) => s.automation_id !== automationId);
  if (remaining.length === cache().length) {
    return;
  }
  owned = remaining;
  persist();
}

/**
 * A claimed session that no longer exists was merged away or deleted, so it
 * holds no slot. Filtered rather than pruned: the claim list outlives a
 * restart, and `appState.sessions` is only populated once projects load.
 */
export function liveOwnedSessions(automationId?: string): OwnedSession[] {
  return listOwnedSessions(automationId).filter((s) =>
    appState.sessions.has(s.session_id),
  );
}
