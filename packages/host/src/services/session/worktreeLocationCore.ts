/**
 * The pure half of worktree-location resolution: no settings, no filesystem.
 *
 * Split out so the settings stores can reuse the cascade without importing the
 * resolver that reads them — that would be a cycle.
 */

import path from "node:path";

/** The suffix that makes a worktrees directory obvious from the outside. */
const SUFFIX = "-argus-worktrees";

/** Who the worktree is for. Automations can be pointed at a separate drive. */
export type WorktreePurpose = "automation" | "user";

export type WorktreeRootSource =
  | "app"
  | "automation_app"
  | "automation_project"
  | "default"
  | "project";

export interface ResolvedWorktreeRoot {
  root: string;
  source: WorktreeRootSource;
}

/** The directory a repo's worktrees get inside a chosen base dir. */
export function worktreeDirName(repoRoot: string): string {
  return `${path.basename(repoRoot) || "repo"}${SUFFIX}`;
}

/**
 * Pure cascade. For automations: per-project automation beats app-wide
 * automation, then it falls through to the user cascade — per-project beats
 * app-wide beats the built-in location.
 *
 * The default branch must stay byte-identical to the original hard-coded path
 * — every existing install resolves through here, and a different string would
 * silently orphan every worktree on disk.
 */
export function computeWorktreesRoot(args: {
  appBase?: string;
  argusHome: string;
  automationAppBase?: string;
  automationProjectBase?: string;
  projectBase?: string;
  purpose?: WorktreePurpose;
  repoRoot: string;
}): ResolvedWorktreeRoot {
  if (args.purpose === "automation") {
    const automationProject = args.automationProjectBase?.trim();
    if (automationProject) {
      return {
        root: path.join(automationProject, worktreeDirName(args.repoRoot)),
        source: "automation_project",
      };
    }

    const automationApp = args.automationAppBase?.trim();
    if (automationApp) {
      return {
        root: path.join(automationApp, worktreeDirName(args.repoRoot)),
        source: "automation_app",
      };
    }
  }

  const project = args.projectBase?.trim();
  if (project) {
    return {
      root: path.join(project, worktreeDirName(args.repoRoot)),
      source: "project",
    };
  }

  const app = args.appBase?.trim();
  if (app) {
    return {
      root: path.join(app, worktreeDirName(args.repoRoot)),
      source: "app",
    };
  }

  return {
    root: path.join(
      args.argusHome,
      "worktrees",
      `${path.basename(args.repoRoot) || "repo"}${SUFFIX}`,
    ),
    source: "default",
  };
}

/** True when `target` is inside `root` (or is it). */
export function isInsideRoot(root: string, target: string): boolean {
  const rel = path.relative(root, target);

  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
