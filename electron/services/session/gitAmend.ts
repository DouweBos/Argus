/**
 * Tip-amend / reword (Phase 2 W11).
 *
 * Refuses if HEAD is at-or-below the merge-base with the base branch
 * (would rewrite shared history) or if the tip is already reachable from
 * `origin/<branch>` (would require a force-push — explicit Phase 6 work).
 */

import { appState } from "../../state";
import { git } from "./git";
import { GitError } from "./gitError";
import { withGitLock } from "./gitLock";

function sessionWorktree(id: string): {
  path: string;
  branch: string;
  base: string | null;
} {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw `Session not found: ${id}`;
  }

  return {
    path: ws.path,
    branch: ws.branch ?? "",
    base: ws.base_branch ?? null,
  };
}

export interface CanAmendResult {
  ok: boolean;
  reason?: string;
}

/**
 * Probe whether the session's tip commit can safely be amended.
 *
 * Returns `{ ok: false, reason }` if:
 * - the HEAD is at or below the merge-base with the base branch; or
 * - the tip is reachable from the upstream branch (already pushed).
 */
export async function gitCanAmendTip(id: string): Promise<CanAmendResult> {
  const ws = sessionWorktree(id);
  if (!ws.path || !ws.branch) {
    return { ok: false, reason: "Session has no branch yet" };
  }

  // Below merge-base?
  if (ws.base) {
    let mergeBase = "";
    try {
      mergeBase = (await git(ws.path, ["merge-base", ws.base, "HEAD"])).trim();
    } catch {
      mergeBase = "";
    }
    if (mergeBase) {
      let headHash = "";
      try {
        headHash = (await git(ws.path, ["rev-parse", "HEAD"])).trim();
      } catch {
        headHash = "";
      }
      if (headHash && headHash === mergeBase) {
        return {
          ok: false,
          reason:
            "Cannot amend: HEAD is at the merge-base with the base branch",
        };
      }
    }
  }

  // Already pushed?
  try {
    const upstream = (
      await git(ws.path, [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{u}",
      ])
    ).trim();
    if (upstream) {
      const tip = (await git(ws.path, ["rev-parse", "HEAD"])).trim();
      try {
        const remoteHas = (
          await git(ws.path, ["branch", "-r", "--contains", tip])
        ).trim();
        if (remoteHas.split("\n").some((l) => l.trim() === upstream)) {
          return {
            ok: false,
            reason:
              "Tip already pushed; rewriting requires force-push (Push dialog).",
          };
        }
      } catch {
        // No remote branch contains it — fine.
      }
    }
  } catch {
    // No upstream — amending is fine.
  }

  return { ok: true };
}

/**
 * Amend the tip commit with new subject/body. Refuses on the same
 * conditions probed by `gitCanAmendTip`.
 */
export async function gitAmendTip(
  id: string,
  subject: string,
  body: string,
): Promise<string> {
  const can = await gitCanAmendTip(id);
  if (!can.ok) {
    const reason = can.reason ?? "Cannot amend tip";
    throw new GitError("non-fast-forward", reason);
  }

  const ws = sessionWorktree(id);
  const args = ["commit", "--amend"];
  const subj = subject.trim();
  const bod = body.trim();
  if (subj.length > 0) {
    args.push("-m", subj);
    if (bod.length > 0) {
      args.push("-m", bod);
    }
  } else {
    // No new message — keep the existing one but refresh the index.
    args.push("--no-edit");
  }

  return withGitLock(ws.path, () => git(ws.path, args));
}
