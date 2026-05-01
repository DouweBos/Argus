/**
 * Phase 7 T6 — git-lfs integration.
 *
 * `gitLfsFiles` returns the list of LFS-tracked paths plus a flag indicating
 * whether `git lfs` is installed. `gitLfsPull` downloads LFS payloads for the
 * full working tree (or a subset of paths). Mutating op gated to project scope.
 */

import { appState } from "../../state";
import { git } from "./git";
import { GitError } from "./gitError";
import { withGitLock } from "./gitLock";

function requireSession(id: string): { path: string } {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw new GitError("unknown", `Session not found: ${id}`);
  }

  return { path: ws.path };
}

export interface LfsFiles {
  lfsInstalled: boolean;
  /** True when the repo has tracked files matching `filter=lfs` attributes. */
  repoUsesLfs: boolean;
  tracked: string[];
}

/**
 * Ask git itself which tracked files have the `filter=lfs` attribute set.
 * Works in worktrees (where `.git` is a file pointing to the common gitdir)
 * and reflects every attribute source git would consult — `.gitattributes`,
 * `.git/info/attributes`, and the global/system attributes files. Returns
 * true only when there are real tracked files claimed by LFS, so projects
 * that don't actually use LFS never trigger the install nag.
 */
async function detectRepoUsesLfs(repoPath: string): Promise<boolean> {
  try {
    const out = await git(repoPath, ["ls-files", "-z", ":(attr:filter=lfs)"]);

    return out.length > 0;
  } catch {
    return false;
  }
}

export async function gitLfsFiles(id: string): Promise<LfsFiles> {
  const { path: repoPath } = requireSession(id);
  const repoUsesLfs = await detectRepoUsesLfs(repoPath);
  let raw: string;
  try {
    raw = await git(repoPath, ["lfs", "ls-files"]);
  } catch {
    return { tracked: [], lfsInstalled: false, repoUsesLfs };
  }
  // Output is `<oid> <* or -> <path>`; we only want the path.
  const tracked = raw
    .split("\n")
    .map((line) => {
      const m = /^[0-9a-f]+\s+\S\s+(.+)$/.exec(line.trim());

      return m ? m[1] : null;
    })
    .filter((v): v is string => Boolean(v));

  return { tracked, lfsInstalled: true, repoUsesLfs };
}

export async function gitLfsPull(
  id: string,
  opts: { paths?: string[] },
): Promise<void> {
  const { path: repoPath } = requireSession(id);
  await withGitLock(repoPath, async () => {
    const args = ["lfs", "pull"];
    if (opts.paths && opts.paths.length > 0) {
      args.push("--include", opts.paths.join(","));
    }
    await git(repoPath, args);
  });
}
