/**
 * `git_status` IPC handler.
 *
 * Single porcelain-v2 call returning the full status snapshot used by the
 * frontend `useGitStatus` hook (spec §8). Concurrent callers for the same
 * worktree are coalesced — only one shell-out runs at a time per worktree.
 */

import fs from "node:fs";
import path from "node:path";
import { appState } from "../../state";
import { git } from "./git";

export interface GitInProgress {
  kind: "bisect" | "cherry-pick" | "merge" | "rebase";
  head: string;
  onto?: string;
}

export interface GitStatus {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  dirtyCount: number;
  stashCount: number;
  conflictCount: number;
  inProgress: GitInProgress | null;
  detached: boolean;
  /** Unix ms timestamp of `.git/FETCH_HEAD` mtime, or null if never fetched. */
  lastFetchAt: number | null;
}

// ---------------------------------------------------------------------------
// In-flight coalescing — multiple concurrent callers for the same worktree
// share the same promise so we never run two `git status` shell-outs at once.
// ---------------------------------------------------------------------------

const inFlight = new Map<string, Promise<GitStatus>>();

/** Resolve the real `.git` directory for a worktree (handles `.git` files). */
async function resolveGitDir(worktreePath: string): Promise<string> {
  const gitPath = path.join(worktreePath, ".git");
  try {
    const stat = fs.statSync(gitPath);
    if (stat.isDirectory()) {
      return gitPath;
    }
    if (stat.isFile()) {
      // worktree pointer file: `gitdir: <path>`
      const content = fs.readFileSync(gitPath, "utf8").trim();
      if (content.startsWith("gitdir: ")) {
        const dir = content.slice("gitdir: ".length).trim();

        return path.isAbsolute(dir) ? dir : path.resolve(worktreePath, dir);
      }
    }
  } catch {
    // Fall through to git-rev-parse below.
  }
  // Fallback: ask git directly.
  const out = await git(worktreePath, ["rev-parse", "--git-dir"]);
  const dir = out.trim();

  return path.isAbsolute(dir) ? dir : path.resolve(worktreePath, dir);
}

interface ParsedHeader {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
}

function parsePorcelainV2(raw: string): {
  header: ParsedHeader;
  dirtyCount: number;
  conflictCount: number;
} {
  let branch = "";
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  let detached = false;
  let dirtyCount = 0;
  let conflictCount = 0;

  for (const line of raw.split("\n")) {
    if (!line) {
      continue;
    }
    if (line.startsWith("# branch.head ")) {
      const v = line.slice("# branch.head ".length).trim();
      if (v === "(detached)") {
        detached = true;
      } else {
        branch = v;
      }
    } else if (line.startsWith("# branch.upstream ")) {
      upstream = line.slice("# branch.upstream ".length).trim();
    } else if (line.startsWith("# branch.ab ")) {
      // Format: "+N -M"
      const m = line.match(/\+(-?\d+)\s+-(-?\d+)/);
      if (m) {
        ahead = parseInt(m[1], 10) || 0;
        behind = parseInt(m[2], 10) || 0;
      }
    } else if (line.startsWith("u ")) {
      // Unmerged entry.
      conflictCount += 1;
      dirtyCount += 1;
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      // Tracked changed (1 = ordinary, 2 = renamed/copied).
      dirtyCount += 1;
    } else if (line.startsWith("? ")) {
      // Untracked.
      dirtyCount += 1;
    }
    // `!` = ignored — not counted.
  }

  return {
    header: { branch, upstream, ahead, behind, detached },
    dirtyCount,
    conflictCount,
  };
}

async function detectInProgress(
  worktreePath: string,
  gitDir: string,
): Promise<GitInProgress | null> {
  const exists = (rel: string): boolean =>
    fs.existsSync(path.join(gitDir, rel));

  if (exists("MERGE_HEAD")) {
    let head = "";
    try {
      head = fs.readFileSync(path.join(gitDir, "MERGE_HEAD"), "utf8").trim();
    } catch {
      // ignore
    }

    return { kind: "merge", head };
  }
  if (exists("rebase-merge") || exists("rebase-apply")) {
    const dir = exists("rebase-merge") ? "rebase-merge" : "rebase-apply";
    let head = "";
    let onto: string | undefined;
    try {
      head = fs
        .readFileSync(path.join(gitDir, dir, "head-name"), "utf8")
        .trim();
    } catch {
      // ignore
    }
    try {
      onto = fs.readFileSync(path.join(gitDir, dir, "onto"), "utf8").trim();
    } catch {
      // ignore
    }

    return { kind: "rebase", head, ...(onto !== undefined && { onto }) };
  }
  if (exists("CHERRY_PICK_HEAD")) {
    let head = "";
    try {
      head = fs
        .readFileSync(path.join(gitDir, "CHERRY_PICK_HEAD"), "utf8")
        .trim();
    } catch {
      // ignore
    }

    return { kind: "cherry-pick", head };
  }
  if (exists("BISECT_LOG")) {
    return { kind: "bisect", head: "" };
  }

  // worktreePath kept for future expansion (e.g. parsing rebase progress).
  return null;
}

async function countStashes(worktreePath: string): Promise<number> {
  try {
    const out = await git(worktreePath, ["stash", "list"]);
    if (!out.trim()) {
      return 0;
    }

    return out.split("\n").filter((l) => l.trim().length > 0).length;
  } catch {
    return 0;
  }
}

async function readLastFetchAt(gitDir: string): Promise<number | null> {
  try {
    const stat = fs.statSync(path.join(gitDir, "FETCH_HEAD"));

    return stat.mtimeMs;
  } catch {
    return null;
  }
}

async function compute(worktreePath: string): Promise<GitStatus> {
  const [raw, gitDir] = await Promise.all([
    git(worktreePath, ["status", "--porcelain=v2", "--branch"]),
    resolveGitDir(worktreePath),
  ]);
  const { header, dirtyCount, conflictCount } = parsePorcelainV2(raw);
  const [inProgress, stashCount, lastFetchAt] = await Promise.all([
    detectInProgress(worktreePath, gitDir),
    countStashes(worktreePath),
    readLastFetchAt(gitDir),
  ]);

  return {
    branch: header.branch,
    upstream: header.upstream,
    ahead: header.ahead,
    behind: header.behind,
    dirtyCount,
    stashCount,
    conflictCount,
    inProgress,
    detached: header.detached,
    lastFetchAt,
  };
}

/**
 * Compute the GitStatus for a session's worktree. Concurrent calls for the
 * same session share the in-flight promise — keeps porcelain shell-outs
 * down to one at a time per worktree.
 */
export async function gitStatus(sessionId: string): Promise<GitStatus> {
  const ws = appState.sessions.get(sessionId);
  if (!ws) {
    throw `Session not found: ${sessionId}`;
  }
  const wtPath = ws.path;
  if (!wtPath) {
    // Session not materialised yet — return an empty status rather than failing.
    return {
      branch: ws.branch ?? "",
      upstream: null,
      ahead: 0,
      behind: 0,
      dirtyCount: 0,
      stashCount: 0,
      conflictCount: 0,
      inProgress: null,
      detached: false,
      lastFetchAt: null,
    };
  }

  const existing = inFlight.get(wtPath);
  if (existing) {
    return existing;
  }
  const promise = compute(wtPath).finally(() => {
    inFlight.delete(wtPath);
  });
  inFlight.set(wtPath, promise);

  return promise;
}
