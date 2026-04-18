import { clearReviewState, setReviewState } from "../stores/reviewQueueStore";
import { listen } from "./events";
import { getWorkspaceCommitsAhead } from "./ipc";

let initialized = false;

/**
 * Subscribe to backend `workspace:review-state` events. The backend emits this
 * whenever a workspace's reviewable state may have changed (agent exit, merge
 * completion). Safe to call multiple times — only the first call takes effect.
 */
export function initReviewQueueListener(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  listen<{ commitsAhead: number; workspaceId: string }>(
    "workspace:review-state",
    (event) => {
      const { workspaceId, commitsAhead } = event.payload;
      setReviewState(workspaceId, commitsAhead);
    },
  );

  listen<string>("workspace:deleted", (event) => {
    clearReviewState(event.payload);
  });
}

/**
 * One-shot seed: fetch the current commits-ahead count for a workspace and
 * populate the review queue store. Used when a project is first opened so
 * existing worktrees show up without needing an agent run.
 */
export async function seedReviewStateForWorkspace(
  workspaceId: string,
): Promise<void> {
  try {
    const count = await getWorkspaceCommitsAhead(workspaceId);
    setReviewState(workspaceId, count);
  } catch {
    // Ignore — workspace may have been removed before seed completed.
  }
}
