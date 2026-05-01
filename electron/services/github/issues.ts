/**
 * List open GitHub issues for a repository via the `gh` CLI.
 *
 * Returns an empty array (rather than throwing) when `gh` is not installed or
 * the user is not authenticated — callers should treat a zero-length result as
 * "not available" rather than an error.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GhIssue {
  number: number;
  title: string;
}

/**
 * Call `gh issue list --json number,title --limit 50` in the given repo root.
 * Returns an empty array on any error (unauthenticated, no repo, etc.).
 */
export async function listGhIssues(repoRoot: string): Promise<GhIssue[]> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["issue", "list", "--json", "number,title", "--limit", "50"],
      { cwd: repoRoot, maxBuffer: 2 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout.trim()) as GhIssue[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed;
  } catch {
    // gh not installed, not authenticated, not a GitHub repo, etc.
    return [];
  }
}
