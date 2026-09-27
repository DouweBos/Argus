/**
 * Branch history and branch operations, narrowed for a phone.
 *
 * Each call is the host op the desktop's branch menu runs, mapped onto the
 * wire shapes in `@argus/remote-protocol`. Refs arrive from a client, so any
 * that could be read as a git option is refused before it reaches `git`.
 */

import type { RemoteBranchCompare, RemoteCommit } from "@argus/remote-protocol";
import { appState } from "../../state";
import { branchPullRequestUrl } from "../github/branchPrUrl";
import {
  gitMergeBranch,
  gitRebaseOnto,
  gitRenameBranch,
} from "../session/gitBranchOps";
import { gitCompareBranches } from "../session/gitCompare";
import { gitPullV2, gitPushV2 } from "../session/gitPushPull";
import { gitSearchLog } from "../session/gitSearch";
import { gitShowCommit } from "../session/sessionOps";
import { pinBranch, unpinBranch } from "../userProjectSettings/store";

/** `-x` would be parsed as a flag by git; no real ref starts with one. */
function assertRef(ref: string): string {
  if (ref.startsWith("-")) {
    throw `Not a branch name: ${ref}`;
  }

  return ref;
}

/** Mutations stay on the project root, like the existing branch methods. */
function projectRoot(sessionId: string): string {
  const session = appState.sessions.get(sessionId);
  if (!session) {
    throw `Session not found: ${sessionId}`;
  }
  if (session.kind !== "project_root") {
    throw "Branch operations are only available on the project root.";
  }

  return session.repo_root;
}

export async function branchLog(
  sessionId: string,
  branch: string,
  count = 100,
): Promise<RemoteCommit[]> {
  const { commits } = await gitSearchLog(sessionId, {
    branch: assertRef(branch),
    limit: count,
  });

  return commits.map((c) => ({
    hash: c.hash,
    short_hash: c.abbreviatedHash,
    subject: c.subject,
    body: c.body,
    author: c.author,
    date: c.date,
    refs: c.refs,
  }));
}

export function commitDiff(sessionId: string, hash: string): Promise<string> {
  return gitShowCommit(sessionId, assertRef(hash));
}

export async function compareBranches(
  sessionId: string,
  left: string,
  right: string,
): Promise<RemoteBranchCompare> {
  const result = await gitCompareBranches(sessionId, {
    left: assertRef(left),
    right: assertRef(right),
  });

  return {
    left_only: result.leftOnly,
    right_only: result.rightOnly,
    merge_base: result.mergeBase,
    would_conflict: result.wouldConflict,
  };
}

export function branchPrUrl(
  sessionId: string,
  branch: string,
): Promise<string | null> {
  return branchPullRequestUrl(sessionId, assertRef(branch));
}

export async function mergeIntoCurrent(
  sessionId: string,
  from: string,
  squash: boolean,
): Promise<void> {
  projectRoot(sessionId);
  await gitMergeBranch(sessionId, { from: assertRef(from), squash });
}

export async function rebaseCurrent(
  sessionId: string,
  onto: string,
): Promise<void> {
  projectRoot(sessionId);
  await gitRebaseOnto(sessionId, { upstream: assertRef(onto) });
}

export function pushBranch(
  sessionId: string,
  opts: {
    branch: string;
    forceWithLease?: boolean;
    remote?: string;
    setUpstream?: boolean;
  },
): Promise<string> {
  projectRoot(sessionId);

  return gitPushV2(sessionId, {
    branch: assertRef(opts.branch),
    remote: opts.remote ? assertRef(opts.remote) : undefined,
    setUpstream: opts.setUpstream,
    forceWithLease: opts.forceWithLease,
  });
}

export function pullCurrent(
  sessionId: string,
  strategy: "ff-only" | "merge" | "rebase",
): Promise<string> {
  projectRoot(sessionId);

  return gitPullV2(sessionId, { strategy });
}

export async function renameLocalBranch(
  sessionId: string,
  from: string,
  to: string,
): Promise<void> {
  projectRoot(sessionId);
  await gitRenameBranch(sessionId, {
    from: assertRef(from),
    to: assertRef(to),
  });
}

export function setBranchPinned(
  sessionId: string,
  branch: string,
  pinned: boolean,
): string[] {
  const repoRoot = projectRoot(sessionId);

  return pinned ? pinBranch(repoRoot, branch) : unpinBranch(repoRoot, branch);
}
