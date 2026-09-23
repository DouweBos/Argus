/**
 * Which of an automation's projects the host can actually read right now.
 *
 * A project on an external drive is reachable or not depending on what is
 * plugged in. Running against one that isn't produces a confident report
 * written from no evidence, which is worse than not running — so the scope is
 * narrowed to what is readable, and a run with nothing readable is skipped.
 */

import path from "node:path";
import { worktreesRoot } from "../session/git";
import { pathAvailability, volumeLabel } from "../session/volumeAvailability";

export interface ScopeAvailability {
  /** Repo roots the host can read, in their original order. */
  available: string[];
  /** Repo roots it cannot, with the drive to reconnect. */
  unavailable: { repo_root: string; volume: string }[];
}

/**
 * A project counts as unreachable when either its checkout or its worktrees
 * are on a drive that isn't connected — an agent needs both.
 */
export function scopeAvailability(repoRoots: string[]): ScopeAvailability {
  const available: string[] = [];
  const unavailable: ScopeAvailability["unavailable"] = [];

  for (const repoRoot of repoRoots) {
    const missing = [repoRoot, worktreesRoot(repoRoot)]
      .map((target) => pathAvailability(target))
      .find((state) => state.state === "volume_missing");
    if (missing?.state === "volume_missing") {
      unavailable.push({
        repo_root: repoRoot,
        volume: volumeLabel(missing.volume),
      });
    } else {
      available.push(repoRoot);
    }
  }

  return { available, unavailable };
}

/**
 * Why this run should not start, or null. Shaped like `dailyBudgetBlock` so it
 * can sit beside it in the same pre-flight.
 */
export function scopeAvailabilityBlock(repoRoots: string[]): string | null {
  if (repoRoots.length === 0) {
    return null;
  }
  const { available, unavailable } = scopeAvailability(repoRoots);
  if (available.length > 0 || unavailable.length === 0) {
    return null;
  }

  const drives = [...new Set(unavailable.map((u) => u.volume))];
  const names = unavailable.map((u) => path.basename(u.repo_root));

  return drives.length === 1
    ? `${drives[0]} isn't connected, so ${names.length === 1 ? names[0] : "no project in scope"} can't be read`
    : `the drives holding this automation's projects (${drives.join(", ")}) aren't connected`;
}
