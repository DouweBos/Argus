/**
 * Renderer-wide listeners for backend session/project lifecycle events. Boots
 * once per process — components no longer subscribe individually.
 */

import type { Session } from "./types";
import { pushError } from "../stores/notificationsStore";
import {
  addSession,
  getSessionState,
  mergeSessionsForProject,
  updateSession,
} from "../stores/sessionStore";
import { listen } from "./events";
import { listSessions } from "./ipc";
import { openProject, purgeAgentsForSession } from "./projectsService";
import { LOCAL_HOST_ID } from "./transport/hostId";

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
  });

  listen<{
    base_branch?: string | null;
    branch?: string;
    display_name?: string | null;
    id: string;
    model?: string | null;
    path?: string;
    runner_id?: string | null;
    status?: Session["status"];
    volume?: string | null;
  }>("session:updated", (event) => {
    const {
      id,
      display_name,
      branch,
      path,
      base_branch,
      status,
      runner_id,
      model,
      volume,
    } = event.payload;
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
    if (runner_id !== undefined) {
      patch.runner_id = runner_id;
    }
    if (model !== undefined) {
      patch.model = model;
    }
    if (volume !== undefined) {
      patch.volume = volume;
    }
    updateSession(id, patch);
  });

  // A drive came or went: relist so its sessions show as (un)available.
  listen<{ repo_root: string }>(
    "session:volumes-changed",
    (event) => {
      const repoRoot = event.payload.repo_root;
      listSessions(repoRoot)
        .then((sessions) => mergeSessionsForProject(repoRoot, sessions))
        .catch(() => {});
    },
    { hostId: LOCAL_HOST_ID },
  );

  listen<string>("session:deleted", (event) => {
    purgeAgentsForSession(event.payload);
  });
}
