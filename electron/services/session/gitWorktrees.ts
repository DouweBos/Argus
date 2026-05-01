/**
 * Read-only worktree listing (Phase 6B P10).
 *
 * Worktree creation/removal is Argus session-management territory and is not
 * exposed here. The view exists so the user can see Argus-managed and manual
 * worktrees side-by-side and switch into them.
 */

import { appState } from "../../state";
import { git } from "./git";
import { GitError } from "./gitError";

function requireSession(id: string) {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw new GitError("unknown", `Session not found: ${id}`);
  }

  return ws;
}

export interface Worktree {
  path: string;
  branch: string | null;
  head: string;
  isMain: boolean;
  isLocked: boolean;
  lockReason?: string;
  isDetached: boolean;
}

export async function gitWorktreeList(id: string): Promise<Worktree[]> {
  const ws = requireSession(id);
  const out = await git(ws.path, ["worktree", "list", "--porcelain"]);
  const blocks = out.split(/\n\n+/).filter((b) => b.trim().length > 0);

  return blocks.map((block, idx) => {
    let path = "";
    let head = "";
    let branch: string | null = null;
    let isLocked = false;
    let lockReason: string | undefined;
    let isDetached = false;
    for (const rawLine of block.split("\n")) {
      const line = rawLine.trim();
      if (line.startsWith("worktree ")) {
        path = line.slice("worktree ".length);
      } else if (line.startsWith("HEAD ")) {
        head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
      } else if (line === "detached") {
        isDetached = true;
      } else if (line.startsWith("locked")) {
        isLocked = true;
        const reason = line.slice("locked".length).trim();
        if (reason.length > 0) {
          lockReason = reason;
        }
      }
    }

    const wt: Worktree = {
      path,
      branch,
      head,
      isMain: idx === 0,
      isLocked,
      isDetached,
    };
    if (lockReason !== undefined) {
      wt.lockReason = lockReason;
    }

    return wt;
  });
}
