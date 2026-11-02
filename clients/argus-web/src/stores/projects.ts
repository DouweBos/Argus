/**
 * Projects, their sessions and agents, and the recent-agents list. Mirrors
 * `HostStore+Sessions`. Agents are listed per project, across every session
 * including the project root.
 */

import { create } from "zustand";
import {
  describeError,
  INITIAL_LOAD,
  isQuietError,
  type LoadState,
} from "@argus/client-core";
import type {
  RemoteAgentStatus,
  RemoteProject,
  RemoteSession,
} from "../lib/protocol";
import { request } from "../lib/request";
import { currentTransport } from "./connection";

/** A poll, a tab resume or a reconnect reload, rather than something the user asked for. */
export interface RefreshOptions {
  background?: boolean;
}

export interface CreateSessionParams {
  repoRoot: string;
  branch: string;
  description: string;
  useExistingBranch?: boolean;
  baseBranch?: string;
}

interface ProjectsState {
  projects: RemoteProject[];
  /** How the last `projects.list` went, for the list's `LoadPhase`. */
  projectsLoad: LoadState;
  sessionsByRepo: Record<string, RemoteSession[]>;
  agentsByRepo: Record<string, RemoteAgentStatus[]>;
  /** All agents across every project, for the home "Recent agents" section. */
  recentAgents: RemoteAgentStatus[];

  refreshProjects: (options?: RefreshOptions) => Promise<void>;
  loadRecentAgents: () => Promise<void>;
  loadSessions: (repoRoot: string) => Promise<void>;
  loadAgents: (repoRoot: string) => Promise<void>;
  createSession: (params: CreateSessionParams) => Promise<RemoteSession>;
  deleteSession: (
    id: string,
    repoRoot: string,
    deleteBranch?: boolean,
  ) => Promise<void>;
  renameSession: (id: string, repoRoot: string, name: string) => Promise<void>;
  renameSessionBranch: (
    id: string,
    repoRoot: string,
    branch: string,
  ) => Promise<void>;
}

const EMPTY = {
  projects: [],
  projectsLoad: INITIAL_LOAD,
  sessionsByRepo: {},
  agentsByRepo: {},
  recentAgents: [],
} satisfies Partial<ProjectsState>;

export const useProjectsStore = create<ProjectsState>()((set, get) => ({
  ...EMPTY,

  refreshProjects: async (options) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    try {
      const { projects } = await request(t, "projects.list", {});
      set({ projects, projectsLoad: { loaded: true, error: null } });
    } catch (err) {
      // The connection badge already says it's down; the next `ready` retries.
      if (!isQuietError(err, options?.background ?? false)) {
        set({ projectsLoad: { loaded: true, error: describeError(err) } });
      }
      throw err;
    }
  },

  loadRecentAgents: async () => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    const { agents } = await request(t, "agents.list", {});
    set({ recentAgents: agents });
  },

  loadSessions: async (repoRoot) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    const { sessions } = await request(t, "sessions.list", {
      repo_root: repoRoot,
    });
    set((s) => ({
      sessionsByRepo: { ...s.sessionsByRepo, [repoRoot]: sessions },
    }));
  },

  loadAgents: async (repoRoot) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    const { agents } = await request(t, "agents.list", {
      repo_root: repoRoot,
    });
    set((s) => ({ agentsByRepo: { ...s.agentsByRepo, [repoRoot]: agents } }));
  },

  createSession: async (params) => {
    const t = currentTransport();
    if (!t) {
      throw new Error("not connected");
    }
    const { session } = await request(t, "sessions.create", {
      repo_root: params.repoRoot,
      branch: params.branch,
      description: params.description,
      ...(params.useExistingBranch ? { use_existing_branch: true } : {}),
      ...(params.baseBranch ? { base_branch: params.baseBranch } : {}),
    });

    return session;
  },

  deleteSession: async (id, repoRoot, deleteBranch) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    await request(t, "sessions.delete", {
      id,
      ...(deleteBranch ? { delete_branch: true } : {}),
    });
    await Promise.all([
      get()
        .loadSessions(repoRoot)
        .catch(() => {}),
      get()
        .loadAgents(repoRoot)
        .catch(() => {}),
    ]);
  },

  renameSession: async (id, repoRoot, name) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    await request(t, "sessions.rename", { id, display_name: name });
    await get()
      .loadSessions(repoRoot)
      .catch(() => {});
  },

  renameSessionBranch: async (id, repoRoot, branch) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    await request(t, "sessions.rename_branch", { id, branch });
    await get()
      .loadSessions(repoRoot)
      .catch(() => {});
  },
}));

/** `agent.status`: update the agent wherever it is listed. */
export function receiveListedAgentStatus(agent: RemoteAgentStatus): void {
  useProjectsStore.setState((s) => {
    const agentsByRepo = { ...s.agentsByRepo };
    let listed = false;
    for (const [repo, list] of Object.entries(agentsByRepo)) {
      if (list.some((x) => x.agent_id === agent.agent_id)) {
        listed = true;
        agentsByRepo[repo] = list.map((x) =>
          x.agent_id === agent.agent_id ? agent : x,
        );
      }
    }
    // A new agent lands in its project's list without waiting for the next poll.
    const repo = listed
      ? undefined
      : Object.entries(s.sessionsByRepo).find(([, sessions]) =>
          sessions.some((x) => x.id === agent.session_id),
        )?.[0];
    if (repo && agentsByRepo[repo]) {
      agentsByRepo[repo] = [...agentsByRepo[repo], agent];
    }
    const recentAgents = s.recentAgents.some(
      (x) => x.agent_id === agent.agent_id,
    )
      ? s.recentAgents.map((x) => (x.agent_id === agent.agent_id ? agent : x))
      : [agent, ...s.recentAgents];

    return { agentsByRepo, recentAgents };
  });
}

/** The project a repo root names, once the list has it. */
export function projectFor(repoRoot: string): RemoteProject | undefined {
  return useProjectsStore
    .getState()
    .projects.find((p) => p.repo_root === repoRoot);
}

/**
 * `sessions.changed`: a named repo reloads just its lists; null means the
 * computer couldn't say which, so every list held is refetched. A repo never
 * listed has nothing to refresh.
 */
export function receiveSessionsChanged(repoRoot: string | null): void {
  const { sessionsByRepo, agentsByRepo, loadSessions, loadAgents } =
    useProjectsStore.getState();
  const repos = repoRoot
    ? [repoRoot]
    : [...new Set([...Object.keys(sessionsByRepo), ...Object.keys(agentsByRepo)])];
  for (const repo of repos) {
    if (sessionsByRepo[repo] !== undefined) {
      loadSessions(repo).catch(() => {});
    }
    if (agentsByRepo[repo] !== undefined) {
      loadAgents(repo).catch(() => {});
    }
  }
}

/** `projects.changed`: a project was opened or closed on the computer. */
export function receiveProjectsChanged(): void {
  useProjectsStore
    .getState()
    .refreshProjects({ background: true })
    .catch(() => {});
}

/** The session on screen, so the host keeps a warm agent there; resent on every `ready`. */
let viewing: { sessionId: string | null; runnerId: string | null } = {
  sessionId: null,
  runnerId: null,
};

function sendViewing(): void {
  const t = currentTransport();
  if (!t) {
    return;
  }
  request(t, "sessions.viewing", {
    session_id: viewing.sessionId,
    ...(viewing.runnerId ? { runner_id: viewing.runnerId } : {}),
  }).catch(() => {});
}

export function setViewingSession(
  sessionId: string | null,
  runnerId: string | null = null,
): void {
  if (viewing.sessionId === sessionId && viewing.runnerId === runnerId) {
    return;
  }
  viewing = { sessionId, runnerId };
  sendViewing();
}

/** A fresh channel: the host forgot what this tab was looking at. */
export function resendViewing(): void {
  if (viewing.sessionId) {
    sendViewing();
  }
}

export function resetProjects(): void {
  viewing = { sessionId: null, runnerId: null };
  useProjectsStore.setState(EMPTY);
}
