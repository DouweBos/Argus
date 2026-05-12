/**
 * Phase 4 H1 — `git_search_log` IPC.
 *
 * Subject/body/author/date/path/diff search over the commit log with
 * cursor-based pagination. Read-only — no `withGitLock`.
 *
 * Pagination cursor: `{ lastCommitHash, lastCommitTimestamp }`. We use
 * `--before=<timestamp>` plus a "skip while we haven't passed the boundary
 * commit" loop to avoid the offset OOM problem on large logs. The cursor
 * records the timestamp+hash of the last commit returned so the next page
 * starts strictly past that boundary even when many commits share a
 * timestamp.
 */

import type { GitCommit } from "./sessionOps";
import { appState } from "../../state";
import { git } from "./git";
import { GitError } from "./gitError";

export interface LogSearchCursor {
  lastCommitHash: string;
  lastCommitTimestamp: string;
}

export interface LogSearchFilters {
  author?: string;
  branch?: string;
  cursor?: LogSearchCursor | null;
  limit?: number;
  paths?: string[];
  query?: string;
  refType?: "all" | "locals" | "remotes" | "tags";
  regex?: boolean;
  since?: string;
  until?: string;
}

export interface LogSearchResult {
  commits: GitCommit[];
  nextCursor: LogSearchCursor | null;
}

const COMMIT_SEP = "---COMMIT_SEP---";
const FORMAT = [
  "%H",
  "%h",
  "%an",
  "%ae",
  "%aI",
  "%cn",
  "%ce",
  "%cI",
  "%P",
  "%T",
  "%s",
  "%D",
  "%b",
].join("%n");

const HASH_RE = /^[0-9a-f]{7,40}$/i;

function sessionPath(id: string): string {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw new GitError("unknown", `Session not found: ${id}`);
  }

  return ws.path;
}

function parseLog(raw: string): GitCommit[] {
  const entries = raw.split(COMMIT_SEP).filter((s) => s.trim());

  return entries.map((entry) => {
    const lines = entry.trim().split("\n");

    return {
      hash: lines[0] ?? "",
      abbreviatedHash: lines[1] ?? "",
      author: lines[2] ?? "",
      authorEmail: lines[3] ?? "",
      date: lines[4] ?? "",
      committer: lines[5] ?? "",
      committerEmail: lines[6] ?? "",
      committerDate: lines[7] ?? "",
      parentHash: lines[8] ?? "",
      treeHash: lines[9] ?? "",
      subject: lines[10] ?? "",
      refs: lines[11] ?? "",
      body: lines.slice(12).join("\n").trim(),
    };
  });
}

export async function gitSearchLog(
  id: string,
  filters: LogSearchFilters = {},
): Promise<LogSearchResult> {
  const wt = sessionPath(id);
  const limit = Math.max(1, Math.min(filters.limit ?? 50, 500));

  const args: string[] = [
    "log",
    "--date-order",
    // `--decorate` is required for `%D` to populate refs when stdout isn't a
    // TTY (the default via `execFile`). Without it the in-memory ahead/behind
    // scan can't find `HEAD ->` or `origin/<base>` decorations and the per-
    // commit sync indicators silently disappear.
    "--decorate=short",
    `--format=${FORMAT}${COMMIT_SEP}`,
  ];

  // Branch / ref-type scoping ----------------------------------------------
  if (filters.branch) {
    // Allow whitespace-separated ref lists so callers can walk a branch
    // alongside its upstream (e.g. "HEAD @{u} origin/main") to visualize
    // divergence. Unknown refs are dropped — sessions often lack @{u} or a
    // pushed remote, and `git log` errors out if any ref doesn't resolve.
    const refs = filters.branch.split(/\s+/).filter(Boolean);
    if (refs.length === 1) {
      args.push(refs[0]!);
    } else {
      const valid: string[] = [];
      for (const ref of refs) {
        try {
          await git(wt, ["rev-parse", "--verify", "--quiet", ref]);
          valid.push(ref);
        } catch {
          // ref doesn't resolve in this worktree — skip it
        }
      }
      if (valid.length > 0) {
        args.push(...valid);
      } else {
        args.push("HEAD");
      }
    }
  } else if (filters.refType === "tags") {
    args.push("--tags");
  } else if (filters.refType === "remotes") {
    args.push("--remotes");
  } else if (filters.refType === "locals") {
    args.push("--branches");
  } else {
    args.push("--exclude=refs/stash", "--all");
  }

  // Author / date filters --------------------------------------------------
  if (filters.author) {
    args.push(`--author=${filters.author}`);
  }
  if (filters.since) {
    args.push(`--since=${filters.since}`);
  }
  if (filters.until) {
    args.push(`--until=${filters.until}`);
  }

  // Cursor: only return commits strictly older than the cursor's timestamp.
  // We over-fetch by one then filter the boundary commit out client-side
  // so duplicate-timestamp commits don't get skipped/repeated.
  let beforeApplied: string | null = null;
  if (filters.cursor) {
    args.push(`--before=${filters.cursor.lastCommitTimestamp}`);
    beforeApplied = filters.cursor.lastCommitHash;
  }

  // Fetch one extra so we can detect end-of-results.
  args.push(`-${limit + 1}`);

  // Query handling ---------------------------------------------------------
  let pathPositional: string[] = filters.paths ?? [];
  const rawQuery = filters.query?.trim() ?? "";
  if (rawQuery.length > 0) {
    if (rawQuery.startsWith("path:")) {
      const p = rawQuery.slice("path:".length).trim();
      if (p) {
        pathPositional = [...pathPositional, p];
      }
    } else if (rawQuery.startsWith("diff:")) {
      const d = rawQuery.slice("diff:".length).trim();
      if (d) {
        args.push(filters.regex ? `-G${d}` : `-S${d}`);
      }
    } else if (HASH_RE.test(rawQuery)) {
      // Plain hash query: log <hash>^..<hash> — bound by the hash itself.
      // Replace branch positional with the range.
      const ref = rawQuery;
      const branchRefs = new Set(
        (filters.branch ?? "").split(/\s+/).filter(Boolean),
      );
      // Drop branch / --all etc. — we want a hash-scoped range.
      const filtered = args.filter(
        (a) =>
          a !== "--all" &&
          a !== "--exclude=refs/stash" &&
          a !== "--tags" &&
          a !== "--remotes" &&
          a !== "--branches" &&
          !branchRefs.has(a),
      );
      filtered.push(`${ref}^..${ref}`);

      try {
        const raw = await git(wt, filtered);
        const commits = parseLog(raw).slice(0, limit);

        return { commits, nextCursor: null };
      } catch {
        // Fall through to plain --grep search if the hash range fails (e.g.
        // root commit has no parent).
      }
    } else {
      args.push(`--grep=${rawQuery}`);
      args.push("--regexp-ignore-case");
    }
  }

  if (pathPositional.length > 0) {
    args.push("--", ...pathPositional);
  }

  let raw: string;
  try {
    raw = await git(wt, args);
  } catch (err) {
    if (err instanceof GitError) {
      throw err;
    }
    throw new GitError(
      "unknown",
      err instanceof Error ? err.message : String(err),
    );
  }

  let commits = parseLog(raw);

  // Skip the boundary commit if it appears in the page (dedupe across pages).
  if (beforeApplied) {
    commits = commits.filter((c) => c.hash !== beforeApplied);
  }

  const hasMore = commits.length > limit;
  const page = commits.slice(0, limit);
  const last = page[page.length - 1];

  return {
    commits: page,
    nextCursor:
      hasMore && last
        ? { lastCommitHash: last.hash, lastCommitTimestamp: last.date }
        : null,
  };
}

// ---------------------------------------------------------------------------
// H4 — git_diff_range
// ---------------------------------------------------------------------------

export interface DiffRangeFile {
  newPath: string;
  oldPath: string;
  patch: string;
  status: string;
}

export interface DiffRangeResult {
  files: DiffRangeFile[];
}

export async function gitDiffRange(
  id: string,
  fromRef: string,
  toRef: string,
): Promise<DiffRangeResult> {
  const wt = sessionPath(id);
  const range = `${fromRef}..${toRef}`;

  const nameStatus = await git(wt, ["diff", "--name-status", range]);
  const files: DiffRangeFile[] = [];

  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const parts = line.split("\t");
    const status = parts[0]!;
    let oldPath = parts[1] ?? "";
    let newPath = parts[1] ?? "";
    if (status.startsWith("R") || status.startsWith("C")) {
      oldPath = parts[1] ?? "";
      newPath = parts[2] ?? oldPath;
    }
    const targetPath = newPath || oldPath;
    let patch = "";
    try {
      patch = await git(wt, ["diff", range, "--", targetPath]);
    } catch {
      patch = "";
    }
    files.push({
      status: status[0] ?? "M",
      oldPath,
      newPath,
      patch,
    });
  }

  return { files };
}

// ---------------------------------------------------------------------------
// H8 — git_file_history
// ---------------------------------------------------------------------------

export async function gitFileHistory(
  id: string,
  filePath: string,
): Promise<GitCommit[]> {
  const wt = sessionPath(id);
  const args = [
    "log",
    "--follow",
    "--date-order",
    `--format=${FORMAT}${COMMIT_SEP}`,
    "--",
    filePath,
  ];

  const raw = await git(wt, args);

  return parseLog(raw);
}
