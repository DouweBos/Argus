/**
 * Project-root branch operations (Phase 6 P2 + P5).
 *
 * All mutating ops are gated to `kind === "project_root"` sessions on the
 * backend — Argus session worktrees are constrained to a single branch,
 * and renaming/checking-out/merging on a session worktree would corrupt
 * the agent's work.
 *
 * Read-only listing endpoints (`gitListLocalBranches`,
 * `gitListRemoteBranches`) accept any session id; they don't mutate.
 */

import { appState } from "../../state";
import { git } from "./git";
import { GitError } from "./gitError";
import { withGitLock } from "./gitLock";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireSession(id: string) {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw new GitError("unknown", `Session not found: ${id}`);
  }

  return ws;
}

/** Throw if `id` does not point at a project-root session. */
function requireProjectScope(id: string): { path: string } {
  const ws = requireSession(id);
  if (ws.kind !== "project_root") {
    throw new GitError(
      "unknown",
      "This operation is only available on the project root",
    );
  }

  return { path: ws.path };
}

// ---------------------------------------------------------------------------
// Listing — read-only, no lock
// ---------------------------------------------------------------------------

export interface BranchCommitSummary {
  hash: string;
  subject: string;
  author: string;
  timestamp: number;
}

export interface EnrichedBranch {
  name: string;
  fullName: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  isCurrent: boolean;
  lastCommit: BranchCommitSummary | null;
}

export interface RemoteBranch {
  name: string;
  remote: string;
  branchName: string;
  lastCommit: BranchCommitSummary | null;
}

const FIELD_SEP = "\x1f"; // unit separator
const RECORD_SEP = "\x1e"; // record separator

const LOCAL_FORMAT = [
  "%(refname)",
  "%(refname:short)",
  "%(upstream:short)",
  "%(upstream:track)",
  "%(HEAD)",
  "%(objectname)",
  "%(contents:subject)",
  "%(authorname)",
  "%(authordate:unix)",
].join(FIELD_SEP);

const REMOTE_FORMAT = [
  "%(refname)",
  "%(refname:short)",
  "%(objectname)",
  "%(contents:subject)",
  "%(authorname)",
  "%(authordate:unix)",
].join(FIELD_SEP);

function parseTrack(track: string): { ahead: number; behind: number } {
  // Examples: "" "[gone]" "[ahead 1]" "[behind 2]" "[ahead 3, behind 4]"
  const ahead = /ahead (\d+)/.exec(track);
  const behind = /behind (\d+)/.exec(track);

  return {
    ahead: ahead ? Number.parseInt(ahead[1] ?? "0", 10) : 0,
    behind: behind ? Number.parseInt(behind[1] ?? "0", 10) : 0,
  };
}

function parseInt0(s: string): number {
  const n = Number.parseInt(s, 10);

  return Number.isFinite(n) ? n : 0;
}

/** Read-only enriched local branch list. */
export async function gitListLocalBranches(
  id: string,
): Promise<EnrichedBranch[]> {
  const ws = requireSession(id);
  const out = await git(ws.path, [
    "for-each-ref",
    `--format=${LOCAL_FORMAT}${RECORD_SEP}`,
    "refs/heads/",
  ]);

  return out
    .split(RECORD_SEP)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [
        fullName = "",
        name = "",
        upstream = "",
        track = "",
        head = "",
        hash = "",
        subject = "",
        author = "",
        ts = "0",
      ] = line.split(FIELD_SEP);
      const { ahead, behind } = parseTrack(track);

      return {
        name,
        fullName,
        upstream: upstream.length > 0 ? upstream : null,
        ahead,
        behind,
        isCurrent: head === "*",
        lastCommit:
          hash.length > 0
            ? {
                hash,
                subject,
                author,
                timestamp: parseInt0(ts) * 1000,
              }
            : null,
      };
    });
}

/** Read-only enriched remote-tracking branch list. */
export async function gitListRemoteBranches(
  id: string,
): Promise<RemoteBranch[]> {
  const ws = requireSession(id);
  const out = await git(ws.path, [
    "for-each-ref",
    `--format=${REMOTE_FORMAT}${RECORD_SEP}`,
    "refs/remotes/",
  ]);

  return (
    out
      .split(RECORD_SEP)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const [, name = "", hash = "", subject = "", author = "", ts = "0"] =
          line.split(FIELD_SEP);
        const slash = name.indexOf("/");
        const remote = slash > 0 ? name.slice(0, slash) : "";
        const branchName = slash > 0 ? name.slice(slash + 1) : name;

        return {
          name,
          remote,
          branchName,
          lastCommit:
            hash.length > 0
              ? {
                  hash,
                  subject,
                  author,
                  timestamp: parseInt0(ts) * 1000,
                }
              : null,
        };
      })
      .filter((b) => b.branchName !== "HEAD")
      // Drop refs that don't have a `<remote>/<branch>` shape (e.g. a stray
      // `refs/remotes/origin` symbolic-ref pointer with no branch suffix).
      .filter((b) => b.remote.length > 0 && b.branchName.length > 0)
  );
}

// ---------------------------------------------------------------------------
// Mutating ops — project scope only, all lock-protected
// ---------------------------------------------------------------------------

export interface CreateBranchOpts {
  name: string;
  startPoint?: string;
  checkout?: boolean;
}

export async function gitCreateBranch(
  id: string,
  opts: CreateBranchOpts,
): Promise<void> {
  const { path } = requireProjectScope(id);
  if (!opts.name.trim()) {
    throw new GitError("unknown", "Branch name cannot be empty");
  }
  await withGitLock(path, async () => {
    if (opts.checkout) {
      const args = ["checkout", "-b", opts.name];
      if (opts.startPoint) {
        args.push(opts.startPoint);
      }
      await git(path, args);
    } else {
      const args = ["branch", opts.name];
      if (opts.startPoint) {
        args.push(opts.startPoint);
      }
      await git(path, args);
    }
  });
}

export interface DeleteBranchOpts {
  name: string;
  force?: boolean;
}

export async function gitDeleteBranch(
  id: string,
  opts: DeleteBranchOpts,
): Promise<void> {
  const { path } = requireProjectScope(id);
  await withGitLock(path, async () => {
    await git(path, ["branch", opts.force ? "-D" : "-d", opts.name]);
  });
}

export interface RenameBranchOpts {
  from: string;
  to: string;
}

export async function gitRenameBranch(
  id: string,
  opts: RenameBranchOpts,
): Promise<void> {
  const { path } = requireProjectScope(id);
  await withGitLock(path, async () => {
    await git(path, ["branch", "-m", opts.from, opts.to]);
  });
}

export interface CheckoutOpts {
  branch: string;
  create?: boolean;
}

export async function gitCheckout(
  id: string,
  opts: CheckoutOpts,
): Promise<void> {
  const { path } = requireProjectScope(id);
  await withGitLock(path, async () => {
    if (opts.create) {
      await git(path, ["checkout", "-b", opts.branch]);
    } else {
      await git(path, ["checkout", opts.branch]);
    }
  });
}

export interface SetUpstreamOpts {
  branch: string;
  upstream: string;
}

export async function gitSetUpstream(
  id: string,
  opts: SetUpstreamOpts,
): Promise<void> {
  const { path } = requireProjectScope(id);
  await withGitLock(path, async () => {
    await git(path, [
      "branch",
      `--set-upstream-to=${opts.upstream}`,
      opts.branch,
    ]);
  });
}

export interface MergeBranchOpts {
  /** Source branch to merge in. */
  from: string;
  /**
   * Optional target branch — if set and not equal to current HEAD, the call
   * is rejected. Switching first is the user's responsibility (Phase 6 P5
   * exposes `gitCheckout` for that).
   */
  into?: string;
  /** When true, passes `--squash` to `git merge` (no merge commit). */
  squash?: boolean;
}

export async function gitMergeBranch(
  id: string,
  opts: MergeBranchOpts,
): Promise<void> {
  const { path } = requireProjectScope(id);
  if (opts.into) {
    const head = (
      await git(path, ["rev-parse", "--abbrev-ref", "HEAD"])
    ).trim();
    if (head !== opts.into) {
      throw new GitError(
        "unknown",
        `HEAD is on ${head}, not ${opts.into} — checkout ${opts.into} first`,
      );
    }
  }
  await withGitLock(path, async () => {
    const args = ["merge", "--no-edit"];
    if (opts.squash) {
      args.push("--squash");
    }
    args.push(opts.from);
    await git(path, args);
  });
}

export interface RebaseOntoOpts {
  upstream: string;
  branch?: string;
}

export async function gitRebaseOnto(
  id: string,
  opts: RebaseOntoOpts,
): Promise<void> {
  const { path } = requireProjectScope(id);
  await withGitLock(path, async () => {
    const args = ["rebase", opts.upstream];
    if (opts.branch) {
      args.push(opts.branch);
    }
    await git(path, args);
  });
}

export interface StashAndCheckoutOpts {
  branch: string;
}

/**
 * Stash uncommitted changes (`git stash push --include-untracked`), switch to
 * `branch`, then immediately pop the stash back. If the pop conflicts, the
 * stash remains on the stack and a descriptive error is thrown so the caller
 * can surface the failure.
 */
export async function gitStashAndCheckout(
  id: string,
  opts: StashAndCheckoutOpts,
): Promise<void> {
  const { path } = requireProjectScope(id);
  await withGitLock(path, async () => {
    await git(path, ["stash", "push", "--include-untracked"]);
    try {
      await git(path, ["checkout", opts.branch]);
    } catch (checkoutErr) {
      // Try to restore stash if checkout itself failed (unlikely but guard it).
      await git(path, ["stash", "pop"]).catch(() => undefined);
      throw checkoutErr;
    }
    await git(path, ["stash", "pop"]);
  });
}

/**
 * Discard all uncommitted changes (`git checkout -- .`) then switch to `branch`.
 */
export async function gitDiscardAndCheckout(
  id: string,
  opts: StashAndCheckoutOpts,
): Promise<void> {
  const { path } = requireProjectScope(id);
  await withGitLock(path, async () => {
    await git(path, ["checkout", "--", "."]);
    await git(path, ["checkout", opts.branch]);
  });
}
