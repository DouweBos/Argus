/**
 * The GitHub "open a PR" page for a branch, built from the repo's own remote —
 * `github.com/compare/<branch>` without an owner/repo is a 404.
 */

import { appState } from "../../state";
import { git } from "../session/git";
import { githubSlugFromUrl } from "./slug";

async function remoteUrl(cwd: string, remote: string): Promise<string | null> {
  try {
    return (await git(cwd, ["remote", "get-url", remote])).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Prefer the branch's upstream remote, then `origin`, then whichever GitHub
 * remote comes first. Null when the repo has no GitHub remote at all.
 */
export async function branchPullRequestUrl(
  sessionId: string,
  branch: string,
): Promise<string | null> {
  const cwd = appState.sessions.get(sessionId)?.path;
  if (!cwd) {
    throw `Session not found: ${sessionId}`;
  }

  let upstreamRemote: string | null = null;
  try {
    upstreamRemote =
      (await git(cwd, ["config", `branch.${branch}.remote`])).trim() || null;
  } catch {
    // No upstream configured.
  }

  let remotes: string[] = [];
  try {
    remotes = (await git(cwd, ["remote"])).split("\n").filter(Boolean);
  } catch {
    return null;
  }
  const order = [
    ...new Set(
      [upstreamRemote, "origin", ...remotes].filter(
        (r): r is string => !!r && remotes.includes(r),
      ),
    ),
  ];

  for (const remote of order) {
    const url = await remoteUrl(cwd, remote);
    const slug = url ? githubSlugFromUrl(url) : null;
    if (slug) {
      return `https://github.com/${slug}/compare/${encodeURIComponent(branch).replace(/%2F/g, "/")}?expand=1`;
    }
  }

  return null;
}
