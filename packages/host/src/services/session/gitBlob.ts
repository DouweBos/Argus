/**
 * Phase 7 image-diff — `git_read_blob_at_ref` IPC.
 *
 * Reads a file from a git tree ref as a base64 string so the renderer can
 * display binary files (images) without them being corrupted by text encoding.
 * When ref is "WORKTREE" (sentinel value) the live worktree file is read from
 * disk instead of from git-object storage.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { appState } from "../../state";
import { GitError } from "./gitError";

const execFileAsync = promisify(execFile);

/** Sentinel ref value meaning "read from the live worktree file". */
export const WORKTREE_REF = "WORKTREE";

function sessionPath(id: string): string {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw new GitError("unknown", `Session not found: ${id}`);
  }

  return ws.path;
}

/**
 * Returns the raw bytes of `filePath` at `ref` encoded as a base64 string.
 *
 * @param id        Session identifier.
 * @param filePath  Repo-relative file path.
 * @param ref       Git ref ("HEAD", a commit SHA, "WORKTREE", etc.).
 *                  Pass "WORKTREE" to read the live file rather than a git object.
 */
export async function gitReadBlobAtRef(
  id: string,
  filePath: string,
  ref: string,
): Promise<string> {
  const wt = sessionPath(id);

  if (ref === WORKTREE_REF) {
    // Read the live worktree file.
    const abs = path.join(wt, filePath);
    try {
      const buf = await fs.promises.readFile(abs);

      return buf.toString("base64");
    } catch (err) {
      throw new GitError(
        "unknown",
        `Cannot read worktree file "${filePath}": ${String(err)}`,
      );
    }
  }

  // Read from git object store: git show <ref>:<path>
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["show", `${ref}:${filePath}`],
      { cwd: wt, encoding: "buffer", maxBuffer: 50 * 1024 * 1024 },
    );

    return (stdout as unknown as Buffer).toString("base64");
  } catch (err) {
    throw new GitError(
      "unknown",
      `Cannot read "${filePath}" at ref "${ref}": ${String(err)}`,
    );
  }
}
