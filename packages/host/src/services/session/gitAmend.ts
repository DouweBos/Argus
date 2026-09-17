/**
 * Tip-amend / reword.
 *
 * No safety gating — pushed/merge-base checks were removed. If amending a
 * pushed commit, the user will need to force-push afterwards; remote branch
 * protections are the right place for that policy.
 */

import { appState } from "../../state";
import { git } from "./git";
import { withGitLock } from "./gitLock";

function sessionWorktree(id: string): { path: string; branch: string } {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw `Session not found: ${id}`;
  }

  return {
    path: ws.path,
    branch: ws.branch ?? "",
  };
}

/** Amend the tip commit with new subject/body. */
export async function gitAmendTip(
  id: string,
  subject: string,
  body: string,
): Promise<string> {
  const ws = sessionWorktree(id);
  if (!ws.path || !ws.branch) {
    throw "Session has no branch yet";
  }

  const args = ["commit", "--amend"];
  const subj = subject.trim();
  const bod = body.trim();
  if (subj.length > 0) {
    args.push("-m", subj);
    if (bod.length > 0) {
      args.push("-m", bod);
    }
  } else {
    args.push("--no-edit");
  }

  return withGitLock(ws.path, () => git(ws.path, args));
}
