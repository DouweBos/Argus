import { clearReviewState, setReviewState } from "../stores/reviewQueueStore";
import { listen } from "./events";
import { getSessionReviewState } from "./ipc";

let initialized = false;

/**
 * Subscribe to backend `session:review-state` events. The backend emits this
 * whenever a session's reviewable state may have changed (agent exit, merge
 * completion, watcher-detected staged-state change). Safe to call multiple
 * times — only the first call takes effect.
 */
export function initReviewQueueListener(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  listen<{
    commitsAhead: number;
    hasStaged: boolean;
    hasUncommitted: boolean;
    sessionId: string;
  }>("session:review-state", (event) => {
    const { sessionId, commitsAhead, hasStaged, hasUncommitted } =
      event.payload;
    setReviewState(sessionId, { commitsAhead, hasStaged, hasUncommitted });
  });

  listen<string>("session:deleted", (event) => {
    clearReviewState(event.payload);
  });
}

/**
 * One-shot seed: fetch the current review state for a session and populate
 * the store. Used when a project is first opened so existing worktrees show
 * up without needing an agent run or watcher tick.
 */
export async function seedReviewStateForSession(
  sessionId: string,
): Promise<void> {
  try {
    const state = await getSessionReviewState(sessionId);
    setReviewState(sessionId, state);
  } catch {
    // Ignore — session may have been removed before seed completed.
  }
}
