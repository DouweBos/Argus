/**
 * What a start composer offers before its agent exists, and the start itself:
 * in the session in front of you, or in a new worktree (fresh or on an
 * existing branch). Mirrors `HostStore+StartAgent`; the host captures
 * `agent_started` and `session_created`, so nothing is counted here.
 */

import { create } from "zustand";
import {
  baseBranchOptions,
  hostStartsWorktree,
  type IssueStartDraft,
  issueSessionParams,
  pickDefaultBaseBranch,
  spawnParams,
  type StartDraft,
  worktreeParams,
} from "@argus/client-core";
import type { LinearIssue } from "@argus/remote-protocol";
import type {
  RemoteAgentCapabilities,
  RemoteAgentStatus,
  RemoteRunner,
  RemoteSession,
} from "../lib/protocol";
import { request } from "../lib/request";
import { useAgentsStore } from "./agents";
import { currentTransport } from "./connection";
import { useProjectsStore } from "./projects";
import { useTranscriptsStore } from "./transcripts";

export interface BaseBranches {
  options: string[];
  /** Preselected base; null when the list is empty. */
  defaultBranch: string | null;
  /** Local branches, for checking one out as it is. */
  local: string[];
}

export type Started =
  | { kind: "agent"; agent: RemoteAgentStatus }
  | { kind: "session"; session: RemoteSession };

interface StartState {
  /** Models and commands a start in this session (and runner) can pick. */
  optionsBySession: Record<string, RemoteAgentCapabilities>;
  runners: RemoteRunner[];
  baseBranchesByRepo: Record<string, BaseBranches>;

  loadOptions: (sessionId: string, runnerId: string | null) => Promise<void>;
  loadRunners: () => Promise<void>;
  loadBaseBranches: (
    repoRoot: string,
    projectRootBranch: string | null,
  ) => Promise<void>;
  start: (
    context: { sessionId: string | null; repoRoot: string | null },
    draft: StartDraft,
  ) => Promise<Started>;
}

const EMPTY = {
  optionsBySession: {},
  runners: [],
  baseBranchesByRepo: {},
} satisfies Partial<StartState>;

function connected() {
  const t = currentTransport();
  if (!t) {
    throw new Error("not connected");
  }

  return t;
}

/** Every session the projects store holds, by id. */
export function heldSession(sessionId: string): RemoteSession | undefined {
  for (const sessions of Object.values(
    useProjectsStore.getState().sessionsByRepo,
  )) {
    const found = sessions.find((s) => s.id === sessionId);
    if (found) {
      return found;
    }
  }

  return undefined;
}

/** An agent in a session with the draft as its first turn. */
async function startInSession(
  sessionId: string,
  draft: StartDraft,
): Promise<RemoteAgentStatus> {
  const { agent } = await request(
    connected(),
    "agents.spawn",
    spawnParams(draft, sessionId),
  );
  const agents = useAgentsStore.getState();
  agents.loadAgentStatus(agent.agent_id).catch(() => {});
  if (draft.effort) {
    await agents.setEffort(agent.agent_id, draft.effort).catch(() => {});
  }
  if (draft.message.trim() || draft.images.length > 0) {
    await useTranscriptsStore
      .getState()
      .sendMessage(
        agent.agent_id,
        draft.message,
        draft.images.length > 0 ? draft.images : undefined,
        draft.displayText,
      );
  }

  return agent;
}

/** Waits out a new worktree's setup (up to 30 minutes), then starts its agent. */
async function startWhenReady(
  session: RemoteSession,
  draft: StartDraft,
): Promise<void> {
  const deadline = Date.now() + 30 * 60_000;
  const projects = useProjectsStore.getState();
  while (Date.now() < deadline) {
    await projects.loadSessions(session.repo_root).catch(() => {});
    const status = heldSession(session.id)?.status;
    if (status === "ready") {
      await startInSession(session.id, draft);

      return;
    }
    if (status === "error" || status === "deleting") {
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export const useStartStore = create<StartState>()((set, get) => ({
  ...EMPTY,

  loadOptions: async (sessionId, runnerId) => {
    const { capabilities } = await request(
      connected(),
      "sessions.start_options",
      { session_id: sessionId, ...(runnerId ? { runner_id: runnerId } : {}) },
    );
    set((s) => ({
      optionsBySession: { ...s.optionsBySession, [sessionId]: capabilities },
    }));
  },

  loadRunners: async () => {
    if (get().runners.length > 0) {
      return;
    }
    // Older computers don't answer, which leaves the picker hidden.
    const { runners } = await request(connected(), "automations.runners", {});
    set({ runners });
  },

  loadBaseBranches: async (repoRoot, projectRootBranch) => {
    const result = await request(connected(), "projects.base_branches", {
      repo_root: repoRoot,
    });
    set((s) => ({
      baseBranchesByRepo: {
        ...s.baseBranchesByRepo,
        [repoRoot]: {
          local: result.local,
          options: baseBranchOptions(
            result.local,
            result.origin_refs,
            result.protected_branches,
          ),
          defaultBranch: pickDefaultBaseBranch(
            result.local,
            result.origin_refs,
            result.default_base_branch,
            result.protected_branches,
            projectRootBranch,
          ),
        },
      },
    }));
  },

  start: async (context, draft) => {
    if (draft.workspace === "current") {
      if (!context.sessionId) {
        throw new Error("There's no session to start in.");
      }

      return {
        kind: "agent",
        agent: await startInSession(context.sessionId, draft),
      };
    }
    if (!context.repoRoot) {
      throw new Error("There's no project to make a worktree in.");
    }
    const { session } = await request(
      connected(),
      "sessions.create",
      worktreeParams(draft, context.repoRoot),
    );
    // Images and effort can't ride the session's own prompt, so this tab starts that agent.
    if (!hostStartsWorktree(draft)) {
      void startWhenReady(session, draft).catch(() => {});
    }
    useProjectsStore
      .getState()
      .loadSessions(context.repoRoot)
      .catch(() => {});

    return { kind: "session", session };
  },
}));

/**
 * One worktree per issue on Linear's branch name, each with an agent the
 * computer starts on the issue once setup finishes. The host captures
 * `session_started_from_issue`.
 */
export async function startFromIssues(
  issues: Pick<LinearIssue, "branchName" | "identifier">[],
  repoRoot: string,
  draft: IssueStartDraft,
): Promise<RemoteSession[]> {
  const started: RemoteSession[] = [];
  for (const issue of issues) {
    const { session } = await request(
      connected(),
      "sessions.create",
      issueSessionParams(issue, draft, repoRoot),
    );
    started.push(session);
  }
  useProjectsStore
    .getState()
    .loadSessions(repoRoot)
    .catch(() => {});

  return started;
}

export function resetStart(): void {
  useStartStore.setState(EMPTY);
}
