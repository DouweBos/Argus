/**
 * Projects, their sessions and agents, and the recent-agents list. Mirrors
 * `HostStore+Sessions`. Agents are listed per project, across every session
 * including the project root.
 */

import { create } from "zustand";
import type {
  RemoteAgentStatus,
  RemoteProject,
  RemoteSession,
} from "../lib/protocol";
import { request } from "../lib/request";
import { currentTransport } from "./connection";

export interface CreateSessionParams {
  repoRoot: string;
  branch: string;
  description: string;
  useExistingBranch?: boolean;
  baseBranch?: string;
}

interface ProjectsState {
  projects: RemoteProject[];
  /** A `projects.list` has answered for this host. */
  projectsLoaded: boolean;
  sessionsByRepo: Record<string, RemoteSession[]>;
  agentsByRepo: Record<string, RemoteAgentStatus[]>;
  /** All agents across every project, for the home "Recent agents" section. */
  recentAgents: RemoteAgentStatus[];

  refreshProjects: () => Promise<void>;
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
  projectsLoaded: false,
  sessionsByRepo: {},
  agentsByRepo: {},
  recentAgents: [],
} satisfies Partial<ProjectsState>;

export const useProjectsStore = create<ProjectsState>()((set, get) => ({
  ...EMPTY,

  refreshProjects: async () => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    const { projects } = await request(t, "projects.list", {});
    set({ projects, projectsLoaded: true });
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
    for (const [repo, list] of Object.entries(agentsByRepo)) {
      if (list.some((x) => x.agent_id === agent.agent_id)) {
        agentsByRepo[repo] = list.map((x) =>
          x.agent_id === agent.agent_id ? agent : x,
        );
      }
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

export function resetProjects(): void {
  useProjectsStore.setState(EMPTY);
}
