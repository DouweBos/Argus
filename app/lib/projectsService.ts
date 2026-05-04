/**
 * Module-level project lifecycle. Owns `openProject` / `closeProject` plus a
 * one-shot `bootstrapProjects()` that hydrates `recentProjectsStore`'s saved
 * open list at app start.
 *
 * Living outside React lets us avoid running the hydration N times for the
 * N components that consume `useProjects()` — historically each mount fired
 * its own `addRepoRoot` IPC call, spamming the main-process log.
 */

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

/** Repo roots that have been registered with the backend in this process. */
const knownRepoRoots = new Set<string>();

let bootstrapped = false;

interface OpenProjectOptions {
  autoSelect?: boolean;
  skipRecent?: boolean;
}

export async function openProject(
  path: string,
  options?: OpenProjectOptions,
): Promise<void> {
  try {
    if (!knownRepoRoots.has(path)) {
      await apiAddRepoRoot(path);
      knownRepoRoots.add(path);
    }
    addProject(path);

    await apiCreateHeadSession(path);

    const sessions = await listSessions(path);
    mergeSessionsForProject(path, sessions);

    await refreshRepoBranch(path);

    const shouldAutoSelect = options?.autoSelect !== false;
    const projectSessions = getSessionState().sessions.filter(
      (w) => w.repo_root === path,
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
      addRecentProject(path);
    }
    addOpenProject(path);
  } catch (err) {
    pushError(err instanceof Error ? err.message : String(err), "open_project");
    throw err;
  }
}

export async function closeProject(repoRoot: string): Promise<void> {
  try {
    await apiRemoveRepoRoot(repoRoot);
    knownRepoRoots.delete(repoRoot);
    removeProject(repoRoot);
    removeOpenProject(repoRoot);
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
) {
  try {
    const session = await apiCreateSession(
      repoRoot,
      branch,
      description,
      useExistingBranch,
      baseBranch,
    );
    if (!getSessionState().sessions.some((w) => w.id === session.id)) {
      addSession(session);
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

  const open = getOpenProjects();
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
