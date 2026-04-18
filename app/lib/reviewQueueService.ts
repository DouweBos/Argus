import { clearReviewState, setReviewState } from "../stores/reviewQueueStore";
import { listen } from "./events";
import { getWorkspaceReviewState } from "./ipc";

let initialized = false;

/**
 * Subscribe to backend `workspace:review-state` events. The backend emits this
 * whenever a workspace's reviewable state may have changed (agent exit, merge
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
    workspaceId: string;
  }>("workspace:review-state", (event) => {
    const { workspaceId, commitsAhead, hasStaged, hasUncommitted } =
      event.payload;
    setReviewState(workspaceId, { commitsAhead, hasStaged, hasUncommitted });
  });

  listen<string>("workspace:deleted", (event) => {
    clearReviewState(event.payload);
  });
}

/**
 * One-shot seed: fetch the current review state for a workspace and populate
 * the store. Used when a project is first opened so existing worktrees show
 * up without needing an agent run or watcher tick.
 */
export async function seedReviewStateForWorkspace(
  workspaceId: string,
): Promise<void> {
  try {
    const state = await getWorkspaceReviewState(workspaceId);
    setReviewState(workspaceId, state);
  } catch {
    // Ignore — workspace may have been removed before seed completed.
  }
}
