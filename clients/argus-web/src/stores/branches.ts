/**
 * A session's branches, history, comparisons, stashes and tags. Mirrors
 * `HostStore+Branches` and `+Stashes`: reads are `monitor`; everything that
 * moves a ref needs `control`, and the computer only accepts branch moves on
 * a project root.
 */

import type {
  GitStashEntry,
  GitTag,
  RemoteBranchCompare,
  RemoteCommit,
  RemoteGitBranch,
} from "@argus/remote-protocol";
import { create } from "zustand";
import {
  describeError,
  isQuietError,
  type LoadState,
  NOT_CONNECTED_MESSAGE,
  type PullStrategy,
} from "@argus/client-core";
import { RemoteError, type Transport } from "@argus/remote-client";
import { request } from "../lib/request";
import type { BranchActedAction } from "../telemetry/events";
import { capture } from "../telemetry/telemetry";
import { currentTransport } from "./connection";
import { useGitStore } from "./git";
import { type RefreshOptions, useProjectsStore } from "./projects";

/** A move the computer may refuse with a reason the screen asks about. */
export type Outcome<B extends string> = "ok" | B;

interface BranchesState {
  bySession: Record<string, RemoteGitBranch[]>;
  loadBySession: Record<string, LoadState>;

  refresh: (sessionId: string, options?: RefreshOptions) => Promise<void>;
  /** "dirty": switching would overwrite local changes; ask before stashing. */
  checkout: (
    sessionId: string,
    branch: string,
    dirty?: "discard" | "stash",
  ) => Promise<Outcome<"dirty">>;
  create: (
    sessionId: string,
    name: string,
    startPoint: string | null,
    checkout: boolean,
  ) => Promise<void>;
  /** "unmerged": it has commits no other branch has; ask before forcing. */
  remove: (
    sessionId: string,
    name: string,
    force: boolean,
  ) => Promise<Outcome<"unmerged">>;
  merge: (sessionId: string, from: string, squash: boolean) => Promise<void>;
  rebase: (sessionId: string, onto: string) => Promise<void>;
  push: (
    sessionId: string,
    branch: RemoteGitBranch,
    forceWithLease: boolean,
  ) => Promise<void>;
  pull: (sessionId: string, strategy: PullStrategy) => Promise<void>;
  rename: (sessionId: string, from: string, to: string) => Promise<void>;
  setPinned: (
    sessionId: string,
    branch: string,
    pinned: boolean,
  ) => Promise<void>;
}

function refreshSessionsOf(sessionId: string): void {
  const projects = useProjectsStore.getState();
  const repoRoot = Object.entries(projects.sessionsByRepo).find(([, list]) =>
    list.some((s) => s.id === sessionId),
  )?.[0];
  if (repoRoot) {
    void projects.loadSessions(repoRoot).catch(() => {});
  }
}

function transport(): Transport {
  const t = currentTransport();
  if (!t) {
    throw new RemoteError("offline", NOT_CONNECTED_MESSAGE);
  }

  return t;
}

export const useBranchesStore = create<BranchesState>()((set, get) => {
  /**
   * Run a move, count it, then refresh the list and the session's status.
   * A call answering `false` was refused with a question, so isn't counted.
   */
  async function act(
    sessionId: string,
    action: BranchActedAction,
    call: (t: Transport) => Promise<unknown>,
  ): Promise<void> {
    try {
      if ((await call(transport())) !== false) {
        capture("web_branch_acted", { action });
      }
    } finally {
      void useGitStore.getState().loadGitStatus(sessionId);
      void get()
        .refresh(sessionId, { background: true })
        .catch(() => {});
    }
  }

  return {
    bySession: {},
    loadBySession: {},

    refresh: async (sessionId, options) => {
      const t = currentTransport();
      if (!t) {
        return;
      }
      try {
        const { branches } = await request(t, "sessions.branches", {
          session_id: sessionId,
        });
        set((s) => ({
          bySession: { ...s.bySession, [sessionId]: branches },
          loadBySession: {
            ...s.loadBySession,
            [sessionId]: { loaded: true, error: null },
          },
        }));
      } catch (err) {
        if (!isQuietError(err, options?.background ?? false)) {
          set((s) => ({
            loadBySession: {
              ...s.loadBySession,
              [sessionId]: { loaded: true, error: describeError(err) },
            },
          }));
        }
      }
    },

    checkout: async (sessionId, branch, dirty) => {
      let outcome: Outcome<"dirty"> = "ok";
      try {
        await act(sessionId, "checkout", async (t) => {
          const result = await request(t, "sessions.checkout", {
            session_id: sessionId,
            branch,
            ...(dirty ? { dirty } : {}),
          });
          if (result.blocked_by === "dirty") {
            outcome = "dirty";

            return false;
          }
          if (!result.accepted) {
            throw new Error(`Couldn't switch to ${branch}.`);
          }

          return true;
        });
      } finally {
        // The session's branch moved: its name everywhere follows.
        refreshSessionsOf(sessionId);
      }

      return outcome;
    },

    create: (sessionId, name, startPoint, checkout) =>
      act(sessionId, "create", (t) =>
        request(t, "sessions.create_branch", {
          session_id: sessionId,
          name,
          checkout,
          ...(startPoint ? { start_point: startPoint } : {}),
        }),
      ),

    remove: async (sessionId, name, force) => {
      let outcome: Outcome<"unmerged"> = "ok";
      await act(sessionId, "delete", async (t) => {
        const result = await request(t, "sessions.delete_branch", {
          session_id: sessionId,
          name,
          force,
        });
        if (result.blocked_by === "unmerged") {
          outcome = "unmerged";

          return false;
        }
        if (!result.accepted) {
          throw new Error(`Couldn't delete ${name}.`);
        }

        return true;
      });

      return outcome;
    },

    merge: (sessionId, from, squash) =>
      act(sessionId, "merge", (t) =>
        request(t, "sessions.merge_branch", {
          session_id: sessionId,
          from,
          squash,
        }),
      ),

    rebase: (sessionId, onto) =>
      act(sessionId, "rebase", (t) =>
        request(t, "sessions.rebase_current", { session_id: sessionId, onto }),
      ),

    push: (sessionId, branch, forceWithLease) =>
      act(sessionId, "push", (t) =>
        request(t, "sessions.push_branch", {
          session_id: sessionId,
          branch: branch.name,
          set_upstream: !branch.upstream,
          force_with_lease: forceWithLease,
        }),
      ),

    pull: (sessionId, strategy) =>
      act(sessionId, "pull", (t) =>
        request(t, "sessions.pull", { session_id: sessionId, strategy }),
      ),

    rename: (sessionId, from, to) =>
      act(sessionId, "rename", (t) =>
        request(t, "sessions.rename_local_branch", {
          session_id: sessionId,
          from,
          to,
        }),
      ),

    setPinned: (sessionId, branch, pinned) =>
      act(sessionId, "pin", (t) =>
        request(t, "sessions.pin_branch", {
          session_id: sessionId,
          branch,
          pinned,
        }),
      ),
  };
});

export function resetBranches(): void {
  useBranchesStore.setState({ bySession: {}, loadBySession: {} });
}

/** `ref` is a local name, or `origin/x` for a remote-only branch. */
export async function branchLog(
  sessionId: string,
  ref: string,
  count = 100,
): Promise<RemoteCommit[]> {
  const { commits } = await request(transport(), "sessions.branch_log", {
    session_id: sessionId,
    branch: ref,
    count,
  });

  return commits;
}

export async function commitDiff(
  sessionId: string,
  hash: string,
): Promise<string> {
  const { diff } = await request(transport(), "sessions.commit_diff", {
    session_id: sessionId,
    hash,
  });

  return diff;
}

export function compareBranches(
  sessionId: string,
  left: string,
  right: string,
): Promise<RemoteBranchCompare> {
  return request(transport(), "sessions.compare_branches", {
    session_id: sessionId,
    left,
    right,
  });
}

/** GitHub's "open a pull request" page; null when the repo has no GitHub remote. */
export async function branchPullRequestUrl(
  sessionId: string,
  branch: string,
): Promise<string | null> {
  const { url } = await request(transport(), "sessions.branch_pr_url", {
    session_id: sessionId,
    branch,
  });

  return url;
}

export async function listStashes(sessionId: string): Promise<GitStashEntry[]> {
  const { stashes } = await request(transport(), "sessions.stashes", {
    session_id: sessionId,
  });

  return stashes;
}

export async function listTags(sessionId: string): Promise<GitTag[]> {
  const { tags } = await request(transport(), "sessions.tags", {
    session_id: sessionId,
  });

  return tags;
}

/** Git's output; a conflicting apply throws and keeps the stash. */
export async function applyStash(
  sessionId: string,
  index: number,
  drop: boolean,
): Promise<string> {
  try {
    const { output } = await request(transport(), "sessions.stash_apply", {
      session_id: sessionId,
      index,
      drop,
    });
    capture("web_branch_acted", { action: drop ? "stash_pop" : "stash_apply" });

    return output;
  } finally {
    void useGitStore.getState().loadGitStatus(sessionId);
  }
}

export async function dropStash(sessionId: string, index: number): Promise<void> {
  await request(transport(), "sessions.stash_drop", {
    session_id: sessionId,
    index,
  });
  capture("web_branch_acted", { action: "stash_drop" });
  void useGitStore.getState().loadGitStatus(sessionId);
}
