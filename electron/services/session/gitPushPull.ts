/**
 * Push/pull v2 (Phase 6B P11) — full options surface for the project-scope
 * dialogs. Both work for any session id; force-with-lease and set-upstream
 * are the most common project-scope-only knobs but the backend doesn't gate
 * — the FE only exposes them where they make sense.
 */

import { appState } from "../../state";
import { git } from "./git";
import { GitError } from "./gitError";
import { withGitLock } from "./gitLock";

function sessionPath(id: string): string {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw new GitError("unknown", `Session not found: ${id}`);
  }

  return ws.path;
}

export interface PushV2Opts {
  remote?: string;
  branch?: string;
  force?: boolean;
  forceWithLease?: boolean;
  setUpstream?: boolean;
  tags?: "all" | "follow" | "none";
  ref?: string;
}

export async function gitPushV2(id: string, opts: PushV2Opts): Promise<string> {
  const wt = sessionPath(id);
  const args = ["push"];
  if (opts.setUpstream) {
    args.push("-u");
  }
  if (opts.force) {
    args.push("--force");
  } else if (opts.forceWithLease) {
    args.push("--force-with-lease");
  }
  if (opts.tags === "all") {
    args.push("--tags");
  } else if (opts.tags === "follow") {
    args.push("--follow-tags");
  }
  const remote = opts.remote ?? "origin";
  if (opts.ref) {
    args.push(remote, opts.ref);
  } else if (opts.branch) {
    args.push(remote, opts.branch);
  } else if (opts.setUpstream) {
    // need explicit ref when -u is set
    args.push(remote, "HEAD");
  }

  return withGitLock(wt, () => git(wt, args));
}

export interface PullV2Opts {
  strategy: "ff-only" | "merge" | "rebase";
  prune?: boolean;
  tags?: boolean;
  remote?: string;
  branch?: string;
}

export async function gitPullV2(id: string, opts: PullV2Opts): Promise<string> {
  const wt = sessionPath(id);
  const args = ["pull"];
  if (opts.strategy === "rebase") {
    args.push("--rebase");
  } else if (opts.strategy === "ff-only") {
    args.push("--ff-only");
  } else {
    args.push("--no-rebase");
  }
  if (opts.prune) {
    args.push("--prune");
  }
  if (opts.tags) {
    args.push("--tags");
  }
  if (opts.remote) {
    args.push(opts.remote);
    if (opts.branch) {
      args.push(opts.branch);
    }
  }

  return withGitLock(wt, () => git(wt, args));
}
