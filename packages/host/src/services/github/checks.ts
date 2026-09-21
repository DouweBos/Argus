/**
 * Whether a branch's PR checks are green, via `gh pr checks`.
 *
 * Returns `null` — not `false` — when the answer is unknowable (no `gh`, no
 * PR, not authenticated). Callers that gate on CI must fail closed on `null`.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface CheckRow {
  bucket?: string;
  state?: string;
}

/** Buckets that do not block a merge. Anything else does. */
const PASSING_BUCKETS = new Set(["pass", "skipping"]);

export async function branchChecksClean(
  repoRoot: string,
  branch: string,
): Promise<boolean | null> {
  let stdout: string;
  try {
    const result = await execFileAsync(
      "gh",
      ["pr", "checks", branch, "--json", "bucket,state"],
      { cwd: repoRoot, maxBuffer: 1024 * 1024 },
    );
    stdout = result.stdout;
  } catch (e) {
    // `gh pr checks` exits non-zero when checks are failing or pending, and
    // still prints the rows — so parse the output before giving up.
    const out = (e as { stdout?: string }).stdout;
    if (typeof out !== "string" || out.trim().length === 0) {
      return null;
    }
    stdout = out;
  }

  let rows: CheckRow[];
  try {
    rows = JSON.parse(stdout) as CheckRow[];
  } catch {
    return null;
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    // No checks configured is not the same as "CI is green".
    return null;
  }

  return rows.every((row) => PASSING_BUCKETS.has(row.bucket ?? ""));
}
