/**
 * The "open a PR" page for a branch, built from the repo's own remote —
 * `github.com/compare/<branch>` without an owner/repo is a 404. GitLab
 * remotes get the new-merge-request form instead.
 */

import { appState } from "../../state";
import { branchCompareUrl } from "../codeHost/remoteUrl";
import { preferredRepoRef } from "../codeHost/repos";

/**
 * Prefer the branch's upstream remote, then `origin`, then whichever code-host
 * remote comes first. Null when the repo has no GitHub or GitLab remote.
 */
export async function branchPullRequestUrl(
  sessionId: string,
  branch: string,
): Promise<string | null> {
  const cwd = appState.sessions.get(sessionId)?.path;
  if (!cwd) {
    throw `Session not found: ${sessionId}`;
  }
  const ref = await preferredRepoRef(cwd, branch);

  return ref ? branchCompareUrl(ref, branch) : null;
}
