/**
 * Phase 4 — working copy view-toggle backends.
 *
 * `gitListIgnoredFiles`  — `git status --ignored=traditional --porcelain`
 * `gitListAssumeUnchangedFiles` — `git ls-files -v` filtered for lowercase
 *   first-letter entries (git marks assume-unchanged files with a lowercase
 *   status character).
 */

import { appState } from "../../state";
import { git } from "./git";

/**
 * Return paths of files that are ignored by git (.gitignore / .git/info/exclude).
 * Paths are relative to the worktree root.
 */
export async function gitListIgnoredFiles(
  sessionId: string,
): Promise<string[]> {
  const ws = appState.sessions.get(sessionId);
  if (!ws?.path) {
    return [];
  }
  let raw = "";
  try {
    // --ignored=traditional surfaces !! entries; --porcelain=v1 keeps output
    // stable across git versions.
    raw = await git(ws.path, [
      "status",
      "--ignored=traditional",
      "--porcelain=v1",
    ]);
  } catch {
    return [];
  }

  const paths: string[] = [];
  for (const line of raw.split("\n")) {
    // Ignored entries start with "!!" in porcelain v1.
    if (line.startsWith("!! ")) {
      paths.push(line.slice(3).trim());
    }
  }

  return paths;
}

/**
 * Return paths of files marked with `git update-index --assume-unchanged`.
 * `git ls-files -v` prints a lowercase status letter for assume-unchanged
 * files (e.g. `h path/to/file.ts`).
 */
export async function gitListAssumeUnchangedFiles(
  sessionId: string,
): Promise<string[]> {
  const ws = appState.sessions.get(sessionId);
  if (!ws?.path) {
    return [];
  }
  let raw = "";
  try {
    raw = await git(ws.path, ["ls-files", "-v"]);
  } catch {
    return [];
  }

  const paths: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line) {
      continue;
    }
    // Assume-unchanged: first char is lowercase (h = assume-unchanged,
    // s = skip-worktree). We capture both.
    const firstChar = line[0] ?? "";
    if (firstChar === firstChar.toLowerCase() && firstChar !== " ") {
      // Format: "<flag> <path>"
      const rest = line.slice(2).trim();
      if (rest) {
        paths.push(rest);
      }
    }
  }

  return paths;
}
