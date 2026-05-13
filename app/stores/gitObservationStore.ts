/**
 * Per-session git observation store. Single source of truth for `gitStatus`,
 * `diffStats`, and the cached review-state slice for any sessionId. Consumers
 * `acquire(id)` to start observation and `release(id)` to drop their stake;
 * the underlying timer + IPC subscriptions ref-count down to one per active
 * session regardless of how many components are watching.
 *
 * Driven by:
 *   - Backend `git_status_changed` event (single global listener, lazy-init).
 *   - Backend `session:diff-changed:{id}` event (per-session, lifecycle-managed).
 *   - 5s safety-poll for `gitStatus` (covers ahead/behind drift the FS watcher
 *     misses — e.g. a remote commit landed elsewhere).
 *   - One-shot fetch on first `acquire`.
 */

import { create } from "zustand";
import { listen } from "../lib/events";
import {
  gitStatus as fetchGitStatus,
  watchSession as ipcWatchSession,
} from "../lib/ipc";
import {
  GIT_STATUS_CHANGED_EVENT,
  type GitStatus,
  type GitStatusChangedPayload,
} from "../lib/types";
import { getAgentsBySession } from "./agentStore";

const POLL_INTERVAL_MS = 5_000;
/** How long cached observations linger after the last consumer leaves. */
const RELEASE_TTL_MS = 60_000;

export interface SessionDiffStats {
  additions: number;
  deletions: number;
  files: number;
}

export interface GitObservation {
  diffStats: SessionDiffStats | null;
  error: string | null;
  lastFetchedAt: number | null;
  status: GitStatus | null;
}

interface State {
  byId: Record<string, GitObservation>;
}

const EMPTY: GitObservation = {
  status: null,
  diffStats: null,
  error: null,
  lastFetchedAt: null,
};

const store = create<State>(() => ({ byId: {} }));

// ---------------------------------------------------------------------------
// Module-private subscription bookkeeping
// ---------------------------------------------------------------------------

const refCounts = new Map<string, number>();
const timers = new Map<string, ReturnType<typeof setInterval>>();
const diffUnlistens = new Map<string, Promise<() => void>>();
const evictTimers = new Map<string, ReturnType<typeof setTimeout>>();
const watchedOnBackend = new Set<string>();

let globalStatusUnsub: Promise<() => void> | null = null;

function ensureGlobalStatusListener(): void {
  if (globalStatusUnsub) {
    return;
  }
  globalStatusUnsub = listen<GitStatusChangedPayload>(
    GIT_STATUS_CHANGED_EVENT,
    (event) => {
      const { sessionId } = event.payload;
      if ((refCounts.get(sessionId) ?? 0) > 0) {
        refreshStatus(sessionId).catch(() => {});
      }
    },
  );
}

function patch(sessionId: string, next: Partial<GitObservation>): void {
  store.setState((s) => {
    const prev = s.byId[sessionId] ?? EMPTY;

    return { byId: { ...s.byId, [sessionId]: { ...prev, ...next } } };
  });
}

async function refreshStatus(sessionId: string): Promise<void> {
  try {
    const next = await fetchGitStatus(sessionId);
    if ((refCounts.get(sessionId) ?? 0) === 0) {
      // Consumer dropped while in-flight — discard.
      return;
    }
    patch(sessionId, {
      status: next,
      error: null,
      lastFetchedAt: Date.now(),
    });
  } catch (err) {
    patch(sessionId, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function startSession(sessionId: string): void {
  ensureGlobalStatusListener();

  if (!watchedOnBackend.has(sessionId)) {
    watchedOnBackend.add(sessionId);
    ipcWatchSession(sessionId).catch(() => {
      // Session may have been deleted; backend will no-op subsequent events.
    });
  }

  if (!diffUnlistens.has(sessionId)) {
    diffUnlistens.set(
      sessionId,
      listen<SessionDiffStats>(`session:diff-changed:${sessionId}`, (event) => {
        if ((refCounts.get(sessionId) ?? 0) === 0) {
          return;
        }
        patch(sessionId, { diffStats: event.payload });
      }),
    );
  }

  if (!timers.has(sessionId)) {
    timers.set(
      sessionId,
      setInterval(() => {
        // The 5s safety-poll only matters when something might mutate the
        // worktree out-of-band (an active agent). Idle sessions rely on the
        // `git_status_changed` FS event for refreshes, so skip the shell-out
        // when no agent is attached — keeps idle workspaces quiet.
        if (getAgentsBySession(sessionId).length === 0) {
          return;
        }
        refreshStatus(sessionId).catch(() => {});
      }, POLL_INTERVAL_MS),
    );
  }

  refreshStatus(sessionId).catch(() => {});
}

function stopSession(sessionId: string): void {
  const timer = timers.get(sessionId);
  if (timer) {
    clearInterval(timer);
    timers.delete(sessionId);
  }
  const diffUnlisten = diffUnlistens.get(sessionId);
  if (diffUnlisten) {
    diffUnlisten.then((fn) => fn()).catch(() => {});
    diffUnlistens.delete(sessionId);
  }
  watchedOnBackend.delete(sessionId);
}

function scheduleEviction(sessionId: string): void {
  const existing = evictTimers.get(sessionId);
  if (existing) {
    clearTimeout(existing);
  }
  evictTimers.set(
    sessionId,
    setTimeout(() => {
      evictTimers.delete(sessionId);
      if ((refCounts.get(sessionId) ?? 0) > 0) {
        return;
      }
      store.setState((s) => {
        if (!(sessionId in s.byId)) {
          return s;
        }
        const next: Record<string, GitObservation> = {};
        for (const [k, v] of Object.entries(s.byId)) {
          if (k !== sessionId) {
            next[k] = v;
          }
        }

        return { byId: next };
      });
    }, RELEASE_TTL_MS),
  );
}

function cancelEviction(sessionId: string): void {
  const t = evictTimers.get(sessionId);
  if (t) {
    clearTimeout(t);
    evictTimers.delete(sessionId);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function acquire(sessionId: string): void {
  const prev = refCounts.get(sessionId) ?? 0;
  refCounts.set(sessionId, prev + 1);
  cancelEviction(sessionId);
  if (prev === 0) {
    startSession(sessionId);
  }
}

export function release(sessionId: string): void {
  const prev = refCounts.get(sessionId) ?? 0;
  if (prev <= 1) {
    refCounts.delete(sessionId);
    stopSession(sessionId);
    scheduleEviction(sessionId);
  } else {
    refCounts.set(sessionId, prev - 1);
  }
}

/** Synchronously read the current observation slice (or `null`). */
export function getGitObservation(sessionId: string): GitObservation | null {
  return store.getState().byId[sessionId] ?? null;
}

/** Hook: subscribe to the slice. */
export function useGitObservationValue(
  sessionId: string,
): GitObservation | null {
  return store((s) => s.byId[sessionId] ?? null);
}

/** Force-refresh the status; consumers don't usually need this. */
export function refreshGitObservation(sessionId: string): Promise<void> {
  return refreshStatus(sessionId);
}

/** Test-only — reset all module-private state. */
export function _resetGitObservationForTest(): void {
  for (const t of timers.values()) {
    clearInterval(t);
  }
  timers.clear();
  for (const p of diffUnlistens.values()) {
    p.then((fn) => fn()).catch(() => {});
  }
  diffUnlistens.clear();
  for (const t of evictTimers.values()) {
    clearTimeout(t);
  }
  evictTimers.clear();
  refCounts.clear();
  watchedOnBackend.clear();
  if (globalStatusUnsub) {
    globalStatusUnsub.then((fn) => fn()).catch(() => {});
    globalStatusUnsub = null;
  }
  store.setState({ byId: {} });
}
