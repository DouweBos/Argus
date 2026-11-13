/**
 * Stacked sessions: a session branched from another session's branch, with
 * the parent recorded so the stack can be restacked and landed as one.
 *
 * Each child remembers the parent commit it was last rebased onto
 * (`stack_base` in the metadata index), so a restack after the parent is
 * amended or rebased replays only the child's own commits.
 */

import type { Session } from "./models";
import fs from "node:fs";
import path from "node:path";
import { emitHostEvent } from "@argus/host/bus";
import { appState } from "../../state";
import { retargetBranchPullRequest } from "../codeHost/pullRequests";
import {
  sessionPullRequest,
  sessionPullRequestMayHaveChanged,
} from "../github/sessionPullRequests";
import { capture as telemetryCapture } from "../telemetry/telemetry";
import { git } from "./git";
import { withGitLock } from "./gitLock";
import {
  getMeta,
  loadMetadata,
  normalizeMetaKey,
  saveMetadata,
} from "./metadata";

/** Where a restack or a landing stopped on a conflict, left paused for the resolver. */
export interface StackConflict {
  files: string[];
  session_id: string;
}

export interface RestackResult {
  conflict: StackConflict | null;
  /** Sessions whose open pull request was force-pushed. */
  pushed: string[];
  /** Sessions rebased onto their parent's new tip. */
  restacked: string[];
}

/** A parent a new session can be stacked on, or a thrown reason why not. */
export function requireStackParent(
  repoRoot: string,
  parentId: string,
): Session {
  const parent = appState.sessions.get(parentId);
  if (!parent) {
    throw `Session not found: ${parentId}`;
  }
  if (parent.repo_root !== repoRoot || parent.kind !== "worktree") {
    throw "Only a worktree session in the same project can be stacked on";
  }
  if (parent.compare_group) {
    throw "A compare run's slot can't be stacked on; keep one of them first";
  }
  if (!parent.branch || parent.status !== "ready") {
    throw "Wait for the session to finish setting up before stacking on it";
  }

  return parent;
}

export async function revParse(
  cwd: string,
  ref: string | undefined,
): Promise<string | null> {
  if (!ref) {
    return null;
  }
  try {
    return (
      await git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`])
    ).trim();
  } catch {
    return null;
  }
}

/** The session's parent, when it is still around. */
export function stackParentOf(session: Session): Session | null {
  const id = session.parent_session_id;
  const parent = id ? appState.sessions.get(id) : undefined;

  return parent && parent.status !== "deleting" ? parent : null;
}

export function stackChildren(id: string): Session[] {
  return [...appState.sessions.values()].filter(
    (s) => s.parent_session_id === id && s.status !== "deleting",
  );
}

/** The bottom of the session's stack: walks parents until one has none. */
export function stackRoot(id: string): Session {
  let session = appState.sessions.get(id);
  if (!session) {
    throw `Session not found: ${id}`;
  }
  const seen = new Set<string>();
  for (;;) {
    seen.add(session.id);
    const parent = stackParentOf(session);
    if (!parent || seen.has(parent.id)) {
      return session;
    }
    session = parent;
  }
}

/** Every session above `id`, parents before children. */
export function stackDescendants(id: string): Session[] {
  const out: Session[] = [];
  const queue = [id];
  const seen = new Set(queue);
  while (queue.length > 0) {
    for (const child of stackChildren(queue.shift()!)) {
      if (!seen.has(child.id)) {
        seen.add(child.id);
        out.push(child);
        queue.push(child.id);
      }
    }
  }

  return out;
}

/** Persist a session's stack fields and announce the change. */
export function saveStackLink(
  session: Session,
  patch: {
    base_branch?: string | null;
    parent_session_id?: string | null;
    stack_base?: string | null;
  },
): void {
  if (patch.base_branch !== undefined) {
    session.base_branch = patch.base_branch;
  }
  if (patch.parent_session_id !== undefined) {
    session.parent_session_id = patch.parent_session_id;
  }
  appState.sessions.set(session.id, session);
  try {
    const meta = loadMetadata(session.repo_root);
    const entry = getMeta(meta, session.path);
    if (entry) {
      meta.set(normalizeMetaKey(session.path), { ...entry, ...patch });
      saveMetadata(session.repo_root, meta);
    }
  } catch {
    // Non-fatal: the next listing rewrites the index from memory.
  }
  if (
    patch.base_branch !== undefined ||
    patch.parent_session_id !== undefined
  ) {
    emitHostEvent("session:updated", {
      id: session.id,
      base_branch: session.base_branch ?? null,
      parent_session_id: session.parent_session_id ?? null,
    });
  }
}

/**
 * The commit the child's own work starts after: the recorded stack base when
 * it is still in the child's history, else git's fork point, else the merge base.
 */
async function childForkPoint(
  child: Session,
  parentRef: string,
): Promise<string> {
  const recorded = getMeta(
    loadMetadata(child.repo_root),
    child.path,
  )?.stack_base;
  if (recorded && (await isAncestor(child.path, recorded, "HEAD"))) {
    return recorded;
  }
  try {
    return (
      await git(child.path, ["merge-base", "--fork-point", parentRef, "HEAD"])
    ).trim();
  } catch {
    return (await git(child.path, ["merge-base", parentRef, "HEAD"])).trim();
  }
}

async function isAncestor(cwd: string, a: string, b: string): Promise<boolean> {
  try {
    await git(cwd, ["merge-base", "--is-ancestor", a, b]);

    return true;
  } catch {
    return false;
  }
}

async function rebaseInProgress(cwd: string): Promise<boolean> {
  for (const dir of ["rebase-merge", "rebase-apply"]) {
    const p = await git(cwd, ["rev-parse", "--git-path", dir]).catch(() => "");
    if (p.trim() && fs.existsSync(path.resolve(cwd, p.trim()))) {
      return true;
    }
  }

  return false;
}

async function conflictedFiles(cwd: string): Promise<string[]> {
  try {
    return (await git(cwd, ["diff", "--name-only", "--diff-filter=U"]))
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Move `child` onto `newBase`, replaying only the commits after its fork
 * point. A conflict leaves the rebase paused in the child's worktree so the
 * conflict resolver can pick it up; the files come back for the caller.
 */
export async function rebaseChildOnto(
  child: Session,
  newBase: string,
  oldBaseRef: string,
): Promise<{ conflict: string[] | null; moved: boolean }> {
  if (await rebaseInProgress(child.path)) {
    return { conflict: await conflictedFiles(child.path), moved: false };
  }
  const newSha = await revParse(child.path, newBase);
  if (!newSha) {
    throw `Can't find ${newBase} to restack onto`;
  }
  if (await isAncestor(child.path, newSha, "HEAD")) {
    saveStackLink(child, { stack_base: newSha });

    return { conflict: null, moved: false };
  }
  const forkPoint = await childForkPoint(child, oldBaseRef);

  return withGitLock(child.path, async () => {
    try {
      await git(child.path, [
        "rebase",
        "--autostash",
        "--onto",
        newSha,
        forkPoint,
        child.branch,
      ]);
    } catch (e) {
      const files = await conflictedFiles(child.path);
      if (files.length > 0) {
        return { conflict: files, moved: false };
      }
      await git(child.path, ["rebase", "--abort"]).catch(() => "");
      throw e;
    }
    saveStackLink(child, { stack_base: newSha });

    return { conflict: null, moved: true };
  });
}

function openPullRequest(id: string) {
  const pr = sessionPullRequest(id);

  return pr && (pr.state === "open" || pr.state === "draft") ? pr : null;
}

async function remoteName(repoRoot: string): Promise<string> {
  const remotes = (await git(repoRoot, ["remote"]))
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (remotes.length === 0) {
    throw "No git remote configured for this repository";
  }

  return remotes.includes("origin") ? "origin" : remotes[0];
}

/**
 * Force-push a session with an open pull request and point the PR at its
 * base branch. Returns whether it pushed; a session without a PR is left local.
 */
export async function syncPullRequest(session: Session): Promise<boolean> {
  const pr = openPullRequest(session.id);
  if (!pr) {
    return false;
  }
  const remote = await remoteName(session.repo_root);
  await pushParentIfMissing(session, remote);
  await withGitLock(session.path, () =>
    git(session.path, [
      "push",
      "--force-with-lease",
      "-u",
      remote,
      session.branch,
    ]),
  );
  if (session.base_branch) {
    await retargetBranchPullRequest({
      repoRoot: session.repo_root,
      head: session.branch,
      number: pr.number,
      base: session.base_branch,
    });
  }
  sessionPullRequestMayHaveChanged(session.id);

  return true;
}

/** A PR can only target a branch the remote has, so a never-pushed parent goes up first. */
async function pushParentIfMissing(session: Session, remote: string) {
  const parent = stackParentOf(session);
  if (!parent || parent.branch !== session.base_branch) {
    return;
  }
  const onRemote = await git(session.repo_root, [
    "ls-remote",
    "--heads",
    remote,
    parent.branch,
  ]).catch(() => "");
  if (!onRemote.trim()) {
    await withGitLock(parent.path, () =>
      git(parent.path, ["push", "-u", remote, parent.branch]),
    );
  }
}

export { openPullRequest, remoteName };

/**
 * Rebase every session stacked above the bottom of `id`'s stack onto its
 * parent's current tip, parents first, then push the ones with open PRs.
 * Stops at the first conflict, leaving it paused for the resolver.
 */
export async function restackSession(id: string): Promise<RestackResult> {
  const root = stackRoot(id);
  const children = stackDescendants(root.id);
  if (children.length === 0) {
    throw "This session has nothing stacked on it";
  }
  let result: RestackResult | null = null;
  try {
    result = await restack(root, children);

    return result;
  } finally {
    telemetryCapture("session_stack_acted", {
      action: "restack",
      success: result !== null && result.conflict === null,
      conflict: Boolean(result?.conflict),
      size: children.length + 1,
    });
  }
}

async function restack(
  root: Session,
  children: Session[],
): Promise<RestackResult> {
  const result: RestackResult = { conflict: null, pushed: [], restacked: [] };
  if (await syncPullRequest(root)) {
    result.pushed.push(root.id);
  }
  for (const child of children) {
    const parent = stackParentOf(child);
    if (!parent) {
      continue;
    }
    if (child.base_branch !== parent.branch) {
      saveStackLink(child, { base_branch: parent.branch });
    }
    const { conflict, moved } = await rebaseChildOnto(
      child,
      parent.branch,
      parent.branch,
    );
    if (conflict) {
      result.conflict = { session_id: child.id, files: conflict };
      break;
    }
    if (moved) {
      result.restacked.push(child.id);
    }
    if (await syncPullRequest(child)) {
      result.pushed.push(child.id);
    }
  }

  return result;
}

/**
 * A deleted parent's children move down onto its base, so the stack keeps
 * pointing at branches that exist. Their commits stay where they are.
 */
export function reparentChildrenOf(session: Session): void {
  for (const child of stackChildren(session.id)) {
    saveStackLink(child, {
      base_branch: session.base_branch ?? null,
      parent_session_id: session.parent_session_id ?? null,
    });
  }
}
