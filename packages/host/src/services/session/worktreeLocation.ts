/**
 * Where a project's worktrees live.
 *
 * The built-in answer is `<argusHome>/worktrees/<Repo>-argus-worktrees`, but a
 * big checkout is often better off on an external drive, so the base directory
 * is configurable app-wide and overridable per project. The per-project value
 * is personal and machine-local — where files sit on *this* machine is not a
 * decision to check into a repo other people clone.
 */

import path from "node:path";
import { argusHomeDir } from "../../lib/argusHome";
import { loadAppSettings } from "../appSettings/store";
import { loadUserProjectSettings } from "../userProjectSettings/store";
import {
  getCachedWorktreeRoot,
  setCachedWorktreeRoot,
} from "./worktreeRootCache";

/** The suffix that makes a worktrees directory obvious from the outside. */
const SUFFIX = "-argus-worktrees";

export type WorktreeRootSource = "app" | "default" | "project";

export interface ResolvedWorktreeRoot {
  root: string;
  source: WorktreeRootSource;
}

/** The directory a repo's worktrees get inside a chosen base dir. */
export function worktreeDirName(repoRoot: string): string {
  return `${path.basename(repoRoot) || "repo"}${SUFFIX}`;
}

/**
 * Pure cascade: per-project beats app-wide beats the built-in location.
 *
 * The default branch must stay byte-identical to the original hard-coded path
 * — every existing install resolves through here, and a different string would
 * silently orphan every worktree on disk.
 */
export function computeWorktreesRoot(args: {
  appBase?: string;
  argusHome: string;
  projectBase?: string;
  repoRoot: string;
}): ResolvedWorktreeRoot {
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

/**
 * Memoized because this sits on the session-list refresh and neither settings
 * store caches its file read. The cache lives in its own module so those
 * stores can invalidate it on write without importing this one.
 */
export function resolveWorktreeRoot(repoRoot: string): ResolvedWorktreeRoot {
  const hit = getCachedWorktreeRoot(repoRoot);
  if (hit) {
    return hit;
  }

  const resolved = computeWorktreesRoot({
    repoRoot,
    projectBase: loadUserProjectSettings(repoRoot).worktrees_base_dir,
    appBase: loadAppSettings().worktrees_base_dir,
    argusHome: argusHomeDir(),
  });
  setCachedWorktreeRoot(repoRoot, resolved);

  return resolved;
}

/**
 * Every root this repo's worktrees may currently sit under, most-current
 * first. Changing the setting without moving the worktrees leaves them at the
 * old root, and they must stay visible until they are moved or deleted.
 */
export function worktreeRootsForRepo(repoRoot: string): string[] {
  const previous = loadUserProjectSettings(repoRoot).previous_worktrees_roots;

  return [
    ...new Set([
      resolveWorktreeRoot(repoRoot).root,
      ...(previous ?? []),
      computeWorktreesRoot({ repoRoot, argusHome: argusHomeDir() }).root,
    ]),
  ];
}

/** True when `target` is inside `root` (or is it). */
export function isInsideRoot(root: string, target: string): boolean {
  const rel = path.relative(root, target);

  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** True when the path sits under any root this repo's worktrees may use. */
export function isKnownWorktreePath(repoRoot: string, target: string): boolean {
  return worktreeRootsForRepo(repoRoot).some((root) =>
    isInsideRoot(root, target),
  );
}
