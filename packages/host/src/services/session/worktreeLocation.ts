/**
 * Where a project's worktrees live.
 *
 * The built-in answer is `<argusHome>/worktrees/<Repo>-argus-worktrees`, but a
 * big checkout is often better off on an external drive, so the base directory
 * is configurable app-wide and overridable per project. The per-project value
 * is personal and machine-local — where files sit on *this* machine is not a
 * decision to check into a repo other people clone.
 *
 * Automations get their own base dir on top of that. A scheduled automation
 * opens worktrees faster than anyone merges them, and a full boot disk breaks
 * every session, not just the automation's.
 *
 * The cascade itself lives in `worktreeLocationCore`; this module is the layer
 * that reads the settings stores.
 */

import { argusHomeDir } from "../../lib/argusHome";
import { loadAppSettings } from "../appSettings/store";
import { loadUserProjectSettings } from "../userProjectSettings/store";
import {
  computeWorktreesRoot,
  isInsideRoot,
  type ResolvedWorktreeRoot,
  type WorktreePurpose,
} from "./worktreeLocationCore";
import {
  getCachedWorktreeRoot,
  setCachedWorktreeRoot,
} from "./worktreeRootCache";

export {
  computeWorktreesRoot,
  isInsideRoot,
  worktreeDirName,
} from "./worktreeLocationCore";
export type {
  ResolvedWorktreeRoot,
  WorktreePurpose,
  WorktreeRootSource,
} from "./worktreeLocationCore";

/**
 * Memoized because this sits on the session-list refresh and neither settings
 * store caches its file read. The cache lives in its own module so those
 * stores can invalidate it on write without importing this one.
 */
export function resolveWorktreeRoot(
  repoRoot: string,
  purpose: WorktreePurpose = "user",
): ResolvedWorktreeRoot {
  const hit = getCachedWorktreeRoot(repoRoot, purpose);
  if (hit) {
    return hit;
  }

  const projectSettings = loadUserProjectSettings(repoRoot);
  const appSettings = loadAppSettings();
  const resolved = computeWorktreesRoot({
    repoRoot,
    purpose,
    projectBase: projectSettings.worktrees_base_dir,
    automationProjectBase: projectSettings.automation_worktrees_base_dir,
    appBase: appSettings.worktrees_base_dir,
    automationAppBase: appSettings.automation_worktrees_base_dir,
    argusHome: argusHomeDir(),
  });
  setCachedWorktreeRoot(repoRoot, purpose, resolved);

  return resolved;
}

/**
 * The roots this repo creates worktrees in right now — one per purpose, which
 * collapses to a single entry unless automations are pointed elsewhere.
 */
export function liveWorktreeRoots(repoRoot: string): string[] {
  return [
    ...new Set([
      resolveWorktreeRoot(repoRoot, "user").root,
      resolveWorktreeRoot(repoRoot, "automation").root,
    ]),
  ];
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
      ...liveWorktreeRoots(repoRoot),
      ...(previous ?? []),
      computeWorktreesRoot({ repoRoot, argusHome: argusHomeDir() }).root,
    ]),
  ];
}

/** True when the path sits under any root this repo's worktrees may use. */
export function isKnownWorktreePath(repoRoot: string, target: string): boolean {
  return worktreeRootsForRepo(repoRoot).some((root) =>
    isInsideRoot(root, target),
  );
}
