/**
 * Phase 4 H9 — `git_reflog` IPC.
 *
 * Read-only reflog listing for HEAD (or a custom ref). Each entry is the
 * minimum metadata the UI needs to render a row: the commit hash, the
 * reflog reference (`HEAD@{N}`), the action (commit / reset / rebase / …),
 * an ISO timestamp, and the subject.
 */

import { appState } from "../../state";
import { git } from "./git";
import { GitError } from "./gitError";

export interface ReflogEntry {
  action: string;
  hash: string;
  refName: string;
  subject: string;
  timestamp: string;
}

export interface ReflogOptions {
  limit?: number;
  ref?: string;
}

function sessionPath(id: string): string {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw new GitError("unknown", `Session not found: ${id}`);
  }

  return ws.path;
}

export async function gitReflog(
  id: string,
  options: ReflogOptions = {},
): Promise<ReflogEntry[]> {
  const wt = sessionPath(id);
  const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
  const ref = options.ref ?? "HEAD";

  const args = [
    "reflog",
    "--pretty=format:%H%x09%gd%x09%gs%x09%cI%x09%s",
    `-${limit}`,
    ref,
  ];

  const raw = await git(wt, args);
  const entries: ReflogEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const parts = line.split("\t");
    if (parts.length < 5) {
      continue;
    }
    const [hash, refName, gs, timestamp, subject] = parts;
    // gs is the "reflog subject", e.g. "commit (initial): foo" or
    // "reset: moving to HEAD~1". Take the leading word as the action.
    const action = (gs ?? "").split(/[\s:]/)[0] ?? "unknown";
    entries.push({
      hash: hash ?? "",
      refName: refName ?? "",
      action,
      timestamp: timestamp ?? "",
      subject: subject ?? "",
    });
  }

  return entries;
}
