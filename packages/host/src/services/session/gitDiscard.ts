/**
 * Discard / untrack / .gitignore helpers (Phase 2 W5).
 *
 * Each function is wrapped in `withGitLock` (per worktree mutex) so it
 * cannot interleave with other mutating ops. Errors flow through the
 * structured `GitError` class via the shared `git()` helper.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { appState } from "../../state";
import { git } from "./git";
import { withGitLock } from "./gitLock";

function sessionPath(id: string): string {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw `Session not found: ${id}`;
  }

  return ws.path;
}

/** Apply a patch via stdin with the given args. */
async function applyPatch(
  wtPath: string,
  patch: string,
  args: string[],
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = execFile(
      "git",
      ["apply", ...args],
      { cwd: wtPath },
      (err: Error | null, _stdout: string, stderr: string) => {
        if (err) {
          reject(`git apply failed: ${stderr}`);
        } else {
          resolve();
        }
      },
    );
    child.stdin?.write(patch);
    child.stdin?.end();
  });
}

/**
 * Discard a tracked file's working-tree changes (`git checkout HEAD -- path`).
 * Untracked files are removed from disk.
 */
export async function gitDiscardFile(
  id: string,
  filePath: string,
): Promise<void> {
  const wt = sessionPath(id);
  await withGitLock(wt, async () => {
    try {
      await git(wt, ["checkout", "HEAD", "--", filePath]);

      return;
    } catch {
      // Likely untracked — fall through to disk delete.
    }
    const full = path.join(wt, filePath);
    if (fs.existsSync(full)) {
      fs.unlinkSync(full);
    }
  });
}

/** Reverse-apply a hunk patch against the working tree. */
export async function gitDiscardHunk(
  id: string,
  hunkPatch: string,
): Promise<void> {
  const wt = sessionPath(id);
  await withGitLock(wt, () =>
    applyPatch(wt, hunkPatch, ["--reverse", "--whitespace=nowarn"]),
  );
}

/**
 * Discard a set of lines from a file's working-tree diff. The renderer
 * supplies the synthesised hunk patch (built from the displayed diff plus
 * the line-set selection); the backend simply reverse-applies it.
 *
 * `lines` and `side` are accepted for forward-compatibility; the current
 * minimal contract is that the patch already encodes the selected lines.
 */
export async function gitDiscardLines(
  id: string,
  _path: string,
  _lines: number[],
  _side: "new" | "old",
  hunkPatch: string,
): Promise<void> {
  const wt = sessionPath(id);
  await withGitLock(wt, () =>
    applyPatch(wt, hunkPatch, ["--reverse", "--whitespace=nowarn"]),
  );
}

/** `git rm --cached` — keep the file on disk but stop tracking it. */
export async function gitUntrackFile(
  id: string,
  filePath: string,
): Promise<void> {
  const wt = sessionPath(id);
  await withGitLock(wt, async () => {
    await git(wt, ["rm", "--cached", "--", filePath]);
  });
}

/**
 * Append a path to the worktree's `.gitignore`. Creates the file if it
 * does not exist; refuses to add a duplicate entry.
 */
export async function addToGitignore(
  id: string,
  filePath: string,
): Promise<void> {
  const wt = sessionPath(id);
  const ignorePath = path.join(wt, ".gitignore");
  await withGitLock(wt, async () => {
    let existing = "";
    if (fs.existsSync(ignorePath)) {
      existing = fs.readFileSync(ignorePath, "utf8");
    }
    const lines = existing.split("\n").map((l) => l.trim());
    if (lines.includes(filePath.trim())) {
      return;
    }
    const needsNewline = existing.length > 0 && !existing.endsWith("\n");
    const next = `${existing}${needsNewline ? "\n" : ""}${filePath}\n`;
    fs.writeFileSync(ignorePath, next, "utf8");
  });
}
