/**
 * Module-level project lifecycle. Owns `openProject` / `closeProject` plus a
 * one-shot `bootstrapProjects()` that hydrates `recentProjectsStore`'s saved
 * open list at app start.
 *
 * Living outside React lets us avoid running the hydration N times for the
 * N components that consume `useProjects()` — historically each mount fired
 * its own `addRepoRoot` IPC call, spamming the main-process log.
 */

import type { CreateSessionLlm } from "./ipc";
import { getAgentState, removeAgent } from "../stores/agentStore";
import { pushError } from "../stores/notificationsStore";
import {
  addOpenProject,
  addRecentProject,
  getOpenProjects,
  removeOpenProject,
} from "../stores/recentProjectsStore";
import {
  addProject,
  addSession,
  getSelectedSessionId,
  getSessionState,
  mergeSessionsForProject,
  removeProject,
  removeSession,
  selectSession,
  sessionHostId,
} from "../stores/sessionStore";
import { stopAgentListening } from "./agentEventService";
import {
  addRepoRoot as apiAddRepoRoot,
  createHeadSession as apiCreateHeadSession,
  createSession as apiCreateSession,
  deleteSession as apiDeleteSession,
  removeRepoRoot as apiRemoveRepoRoot,
  listSessions,
} from "./ipc";
import { refreshRepoBranch } from "./repoBranchSync";
import { LOCAL_HOST_ID, hostScopedKey, type HostId } from "./transport/hostId";
import { projectHost, rememberProjectHost } from "./transport/hostIndex";

/** Repo roots registered with a backend in this process, keyed by host. */
const knownRepoRoots = new Set<string>();

let bootstrapped = false;

interface OpenProjectOptions {
  autoSelect?: boolean;
  /** Machine the repo is on. Defaults to this Mac. */
  hostId?: HostId;
  skipRecent?: boolean;
}

export async function openProject(
  path: string,
  options?: OpenProjectOptions,
): Promise<void> {
  const hostId = options?.hostId ?? LOCAL_HOST_ID;
  try {
    // Learn the owner before the first call so every command about this repo
    // is routed to the machine holding it.
    rememberProjectHost(path, hostId);
    const known = hostScopedKey(hostId, path);
    if (!knownRepoRoots.has(known)) {
      await apiAddRepoRoot(path);
      knownRepoRoots.add(known);
    }
    addProject(path, hostId);

    await apiCreateHeadSession(path);

    const sessions = await listSessions(path);
    mergeSessionsForProject(path, sessions, hostId);

    await refreshRepoBranch(path, hostId);

    const shouldAutoSelect = options?.autoSelect !== false;
    const projectSessions = getSessionState().sessions.filter(
      (w) => w.repo_root === path && sessionHostId(w.id) === hostId,
    );
    if (
      shouldAutoSelect &&
      projectSessions.length > 0 &&
      getSelectedSessionId() === null
    ) {
      const repoRootWs = projectSessions.find((w) => w.kind === "project_root");
      selectSession((repoRootWs ?? projectSessions[0]).id);
    }

    if (!options?.skipRecent) {
      addRecentProject(path, hostId);
    }
    addOpenProject(path, hostId);
  } catch (err) {
    pushError(err instanceof Error ? err.message : String(err), "open_project");
    throw err;
  }
}

export async function closeProject(
  repoRoot: string,
  hostId: HostId = LOCAL_HOST_ID,
): Promise<void> {
  try {
    await apiRemoveRepoRoot(repoRoot);
    knownRepoRoots.delete(hostScopedKey(hostId, repoRoot));
    removeProject(repoRoot, hostId);
    removeOpenProject(repoRoot, hostId);
  } catch (err) {
    pushError(
      err instanceof Error ? err.message : String(err),
      "close_project",
    );
  }
}

export async function createSessionInProject(
  repoRoot: string,
  branch: string,
  description: string,
  useExistingBranch?: boolean,
  baseBranch?: string,
  llm?: CreateSessionLlm,
) {
  try {
    const session = await apiCreateSession(
      repoRoot,
      branch,
      description,
      useExistingBranch,
      baseBranch,
      llm,
    );
    if (!getSessionState().sessions.some((w) => w.id === session.id)) {
      addSession(session, projectHost(repoRoot) ?? LOCAL_HOST_ID);
    }

    return session;
  } catch (err) {
    pushError(
      err instanceof Error ? err.message : String(err),
      "create_session",
    );
    throw err;
  }
}

export async function deleteSessionById(
  id: string,
  deleteBranch?: boolean,
): Promise<void> {
  try {
    await apiDeleteSession(id, deleteBranch);
  } catch (err) {
    pushError(
      err instanceof Error ? err.message : String(err),
      "delete_session",
    );
    throw err;
  }
}

/**
 * Hydrate saved open projects from `recentProjectsStore`. Idempotent — only
 * the first call has effect. Call once at renderer start, before any
 * `useProjects()` consumer renders.
 */
export async function bootstrapProjects(): Promise<void> {
  if (bootstrapped) {
    return;
  }
  bootstrapped = true;

  // Only this Mac's projects: an attached host hydrates its own, and a host
  // that is not attached has no sidebar rows at all.
  const open = getOpenProjects().filter((p) => p.hostId === LOCAL_HOST_ID);
  for (const p of open) {
    try {
      await openProject(p.path, { autoSelect: false, skipRecent: true });
    } catch {
      removeOpenProject(p.path);
    }
  }
}

/** Internal — for the `session:deleted` listener. Mirrors the old hook. */
export function purgeAgentsForSession(sessionId: string): void {
  const agents = getAgentState().agents;
  for (const agent of Object.values(agents)) {
    if (agent.session_id === sessionId) {
      stopAgentListening(agent.agent_id);
      removeAgent(agent.agent_id);
    }
  }
  if (getSessionState().sessions.some((w) => w.id === sessionId)) {
    removeSession(sessionId);
  }
}

/** Internal — re-exported for tests. */
export function _resetProjectsServiceForTest(): void {
  bootstrapped = false;
  knownRepoRoots.clear();
}
