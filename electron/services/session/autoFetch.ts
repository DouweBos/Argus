/**
 * Auto-fetch service — runs `git fetch --prune --quiet` on a configurable
 * interval per session, then emits `git_status_changed` so the UI's
 * `lastFetchAt` timestamp updates.
 *
 * One timer is kept per repo-root (not per session) since all sessions in the
 * same repo share the same remote refs. The timer interval is driven by the
 * `auto_fetch_minutes` field in `.argus.json`.
 *
 * Timers are stopped when:
 *   - `stopAutoFetch(sessionId)` is called (session deleted).
 *   - `auto_fetch_minutes` is 0 / null (via `reconfigureAutoFetch`).
 */

import { info, warn } from "../../../app/lib/logger";
import { getMainWindow } from "../../main";
import { appState } from "../../state";
import { git } from "./git";

interface FetchTimer {
  interval: ReturnType<typeof setInterval>;
  /** When true, a fetch is already running — don't start another. */
  inFlight: boolean;
  /** Repo root this timer fetches for. */
  repoRoot: string;
}

// Keyed by sessionId — each session with auto-fetch configured gets its own
// timer so they can have independent intervals and clean up independently.
const timers = new Map<string, FetchTimer>();

/**
 * Run a single fetch for the repo and emit `git_status_changed` for all
 * sessions belonging to that repo so the UI updates.
 */
async function runFetch(sessionId: string, repoRoot: string): Promise<void> {
  const timer = timers.get(sessionId);
  if (!timer || timer.inFlight) {
    return;
  }
  timer.inFlight = true;
  try {
    await git(repoRoot, ["fetch", "--prune", "--quiet"]);
    info(`autoFetch: fetched ${repoRoot} (session ${sessionId})`);
  } catch (err) {
    warn(`autoFetch: fetch failed for ${repoRoot}:`, err);
  } finally {
    if (timers.has(sessionId)) {
      timers.get(sessionId)!.inFlight = false;
    }
    // Notify every session in this repo so their status strips refresh.
    const win = getMainWindow();
    if (win) {
      for (const ws of appState.sessions.values()) {
        if (ws.repo_root === repoRoot) {
          win.webContents.send("git_status_changed", { sessionId: ws.id });
        }
      }
    }
  }
}

/**
 * Start or restart an auto-fetch timer for a session. If `minutes` is
 * null/0/negative the timer is stopped (no-op if already stopped).
 */
export function reconfigureAutoFetch(
  sessionId: string,
  repoRoot: string,
  minutes: number | null | undefined,
): void {
  // Clear any existing timer for this session first.
  const existing = timers.get(sessionId);
  if (existing) {
    clearInterval(existing.interval);
    timers.delete(sessionId);
  }

  if (!minutes || minutes <= 0) {
    return;
  }

  const ms = minutes * 60 * 1000;
  info(
    `autoFetch: starting timer for session ${sessionId} (${minutes} min, repo=${repoRoot})`,
  );

  const interval = setInterval(() => {
    runFetch(sessionId, repoRoot).catch((err) => {
      warn(`autoFetch: unhandled error in runFetch for ${sessionId}:`, err);
    });
  }, ms);

  timers.set(sessionId, { interval, inFlight: false, repoRoot });
}

/**
 * Stop and clean up the auto-fetch timer for a session. Call this when the
 * session is closed/deleted.
 */
export function stopAutoFetch(sessionId: string): void {
  const timer = timers.get(sessionId);
  if (!timer) {
    return;
  }
  clearInterval(timer.interval);
  timers.delete(sessionId);
  info(`autoFetch: stopped timer for session ${sessionId}`);
}

/**
 * Reconfigure auto-fetch for all sessions belonging to `repoRoot`. Called
 * when the user changes `auto_fetch_minutes` in the project settings UI.
 */
export function reconfigureAutoFetchForRepo(
  repoRoot: string,
  minutes: number | null | undefined,
): void {
  for (const ws of appState.sessions.values()) {
    if (ws.repo_root === repoRoot && ws.status === "ready") {
      reconfigureAutoFetch(ws.id, repoRoot, minutes);
    }
  }
}
