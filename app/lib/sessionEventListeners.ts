/**
 * Renderer-wide listeners for backend session/project lifecycle events. Boots
 * once per process — components no longer subscribe individually.
 */

import type { Session } from "./types";
import { pushError } from "../stores/notificationsStore";
import {
  addSession,
  getSessionState,
  updateSession,
} from "../stores/sessionStore";
import { listen } from "./events";
import { openProject, purgeAgentsForSession } from "./projectsService";
import { seedReviewStateForSession } from "./reviewQueueService";

let initialized = false;

export function initSessionEventListeners(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  listen<{ error: string; id: string }>("session:delete-failed", (event) => {
    const { error: message } = event.payload;
    pushError(`Failed to delete session: ${message}`, "delete_session");
  });

  listen<string>("project:added", (event) => {
    const repoRoot = event.payload;
    openProject(repoRoot, { autoSelect: false, skipRecent: true }).catch(
      () => {},
    );
  });

  listen<Session>("session:created", (event) => {
    const ws = event.payload;
    if (!getSessionState().sessions.some((w) => w.id === ws.id)) {
      addSession(ws);
    }
    if (ws.kind === "worktree") {
      seedReviewStateForSession(ws.id).catch(() => {});
    }
  });

  listen<{
    base_branch?: string | null;
    branch?: string;
    display_name?: string | null;
    id: string;
    path?: string;
    status?: Session["status"];
  }>("session:updated", (event) => {
    const { id, display_name, branch, path, base_branch, status } =
      event.payload;
    if (!getSessionState().sessions.some((w) => w.id === id)) {
      return;
    }
    const patch: Partial<Session> = {};
    if (display_name !== undefined) {
      patch.display_name = display_name ?? null;
    }
    if (branch !== undefined) {
      patch.branch = branch;
    }
    if (path !== undefined) {
      patch.path = path;
    }
    if (base_branch !== undefined) {
      patch.base_branch = base_branch;
    }
    if (status !== undefined) {
      patch.status = status;
    }
    updateSession(id, patch);
  });

  listen<string>("session:deleted", (event) => {
    purgeAgentsForSession(event.payload);
  });
}
