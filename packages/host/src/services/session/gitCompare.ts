/**
 * Phase 5 — Compare-branches backend.
 *
 * Exposes `gitCompareBranches` which runs a three-way `git rev-list
 * --left-right` walk to find commits that diverged from the merge-base, then
 * optionally checks whether a merge would produce conflicts via
 * `git merge-tree --write-tree`.
 */

import type { BranchCommitSummary } from "./gitBranchOps";
import { appState } from "../../state";
import { git } from "./git";
import { GitError } from "./gitError";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CompareResult {
  /** Commits on `left` not reachable from `right`, newest first. */
  leftOnly: BranchCommitSummary[];
  /** Commits on `right` not reachable from `left`, newest first. */
  rightOnly: BranchCommitSummary[];
  /** SHA of the merge-base, or null when the refs share no history. */
  mergeBase: string | null;
  /**
   * Best-effort heuristic: true if `git merge-tree` reports conflict markers.
   * Returns false when the merge-base is absent or `git merge-tree` fails.
   */
  wouldConflict: boolean;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Whether merging `right` into `left` would conflict. `--write-tree` takes the
 * two branches and finds their base itself; it exits 1 and lists `CONFLICT`
 * lines on stdout when the merge isn't clean. Best-effort: other failures
 * (e.g. a git too old for `--write-tree`) read as no conflict.
 */
export async function mergeWouldConflict(
  cwd: string,
  left: string,
  right: string,
): Promise<boolean> {
  try {
    await git(cwd, ["merge-tree", "--write-tree", left, right]);

    return false;
  } catch (err: unknown) {
    return err instanceof GitError && err.kind === "merge-conflict";
  }
}

const FIELD_SEP = "\x1f";
const RECORD_SEP = "\x1e";

/** --pretty=format string that encodes fields with unit/record separators. */
const COMPARE_FORMAT = [
  "%H", // 0 full hash
  "%an", // 1 author name
  "%at", // 2 unix timestamp
  "%s", // 3 subject
].join(FIELD_SEP);

function parseCommits(raw: string): BranchCommitSummary[] {
  const out: BranchCommitSummary[] = [];
  if (!raw.trim()) {
    return out;
  }
  const records = raw
    .split(RECORD_SEP)
    .map((r) => r.trim())
    .filter(Boolean);
  for (const record of records) {
    const [hash, author, tsRaw, ...rest] = record.split(FIELD_SEP);
    if (!hash || !author || !tsRaw) {
      continue;
    }
    out.push({
      hash: hash.trim(),
      author: author.trim(),
      timestamp: Number(tsRaw.trim()) * 1000,
      subject: rest.join(FIELD_SEP).trim(),
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Exported service function
// ---------------------------------------------------------------------------

export async function gitCompareBranches(
  sessionId: string,
  { left, right }: { left: string; right: string },
): Promise<CompareResult> {
  const ws = appState.sessions.get(sessionId);
  if (!ws) {
    throw new GitError("unknown", `Session not found: ${sessionId}`);
  }
  const cwd = ws.path;

  // 1. Diverging commit lists via --left-right (< = left-only, > = right-only).
  //    --pretty=format:<COMPARE_FORMAT> + RECORD_SEP as separator.
  let revListRaw: string;
  try {
    revListRaw = await git(cwd, [
      "rev-list",
      "--left-right",
      `--pretty=format:${COMPARE_FORMAT}${RECORD_SEP}`,
      `${left}...${right}`,
    ]);
  } catch {
    // If either ref is unknown, return empty lists rather than crashing.
    return {
      leftOnly: [],
      rightOnly: [],
      mergeBase: null,
      wouldConflict: false,
    };
  }

  const leftOnly: BranchCommitSummary[] = [];
  const rightOnly: BranchCommitSummary[] = [];

  // Each block emitted by --left-right looks like:
  //   < <hash>\n<fields>RECORD_SEP   (left-only commit)
  //   > <hash>\n<fields>RECORD_SEP   (right-only commit)
  //
  // We strip the commit-header lines (lines starting with `<` or `>`) that git
  // injects when --pretty=format is used alongside --left-right, then split on
  // RECORD_SEP to obtain the formatted payloads.
  const cleaned = revListRaw
    .split("\n")
    .map((line) => {
      // `rev-list --pretty` prints the side as `commit <hash` / `commit >hash`.
      // The hash is the format's first field, so the header only says the side.
      const header = /^commit ([<>])[0-9a-f]+$/.exec(line);
      if (header) {
        return header[1] === "<" ? "__LEFT__" : "__RIGHT__";
      }
      if (line.startsWith("< ") || line.startsWith("> ")) {
        // Header line: capture direction then discard the hash — the hash is
        // repeated in the first field of our format string.
        return line.startsWith("< ")
          ? `__LEFT__${line.slice(2)}`
          : `__RIGHT__${line.slice(2)}`;
      }

      return line;
    })
    .join("\n");

  // Re-split by RECORD_SEP blocks.
  let currentSide: "left" | "right" | null = null;
  let accumulated = "";

  for (const line of cleaned.split("\n")) {
    if (line.startsWith("__LEFT__")) {
      // Commit separator: flush the previous accumulated block.
      if (currentSide && accumulated.trim()) {
        const commits = parseCommits(accumulated.trim());
        if (currentSide === "left") {
          leftOnly.push(...commits);
        } else {
          rightOnly.push(...commits);
        }
      }
      currentSide = "left";
      accumulated = line.slice("__LEFT__".length);
    } else if (line.startsWith("__RIGHT__")) {
      if (currentSide && accumulated.trim()) {
        const commits = parseCommits(accumulated.trim());
        if (currentSide === "left") {
          leftOnly.push(...commits);
        } else {
          rightOnly.push(...commits);
        }
      }
      currentSide = "right";
      accumulated = line.slice("__RIGHT__".length);
    } else {
      accumulated += "\n" + line;
    }
  }
  // Flush final block.
  if (currentSide && accumulated.trim()) {
    const commits = parseCommits(accumulated.trim());
    if (currentSide === "left") {
      leftOnly.push(...commits);
    } else {
      rightOnly.push(...commits);
    }
  }

  // 2. Merge-base.
  let mergeBase: string | null = null;
  try {
    const mbRaw = await git(cwd, ["merge-base", left, right]);
    mergeBase = mbRaw.trim() || null;
  } catch {
    // No common history — mergeBase stays null.
  }

  // 3. Conflict check via `git merge-tree --write-tree`.
  const wouldConflict = mergeBase
    ? await mergeWouldConflict(cwd, left, right)
    : false;

  return { leftOnly, rightOnly, mergeBase, wouldConflict };
}
