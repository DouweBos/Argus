/**
 * Keeps `sessionStore.projects[].repoBranch` in sync with the backend's git
 * watcher. Subscribes once at app start to the global `git_status_changed`
 * event; when the changed session is a project_root, refetches that repo's
 * current branch and updates the store.
 *
 * This replaces the per-component `getRepoBranch` polls that used to live in
 * `useProjectSessions.refresh()` — one event-driven path for the whole app.
 */

import { getSessionState, setProjectBranch } from "../stores/sessionStore";
import { listen } from "./events";
import { getRepoBranch } from "./ipc";
import {
  GIT_STATUS_CHANGED_EVENT,
  type GitStatusChangedPayload,
} from "./types";

let initialized = false;

async function refreshFor(repoRoot: string): Promise<void> {
  try {
    const branch = await getRepoBranch(repoRoot);
    setProjectBranch(repoRoot, branch);
  } catch {
    setProjectBranch(repoRoot, null);
  }
}

/** Trigger an immediate refresh — used by BranchSwitcher after a checkout. */
export function refreshRepoBranch(repoRoot: string): Promise<void> {
  return refreshFor(repoRoot);
}

export function initRepoBranchSync(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  listen<GitStatusChangedPayload>(GIT_STATUS_CHANGED_EVENT, (event) => {
    const { sessionId } = event.payload;
    const session = getSessionState().sessions.find((s) => s.id === sessionId);
    if (!session || session.kind !== "project_root") {
      return;
    }
    refreshFor(session.repo_root).catch(() => {});
  });
}
