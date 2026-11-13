/**
 * Which worktrees the cleanup policy removes. Pure: the sweep and the dry run
 * both feed it what they measured, so the preview is exactly what a sweep does.
 */

import type {
  WorktreeCleanupEntry,
  WorktreeCleanupGuard,
  WorktreeCleanupPolicy,
} from "@argus/remote-protocol";

export const DAY_MS = 24 * 60 * 60 * 1000;
const GB = 1024 ** 3;
/** The disk cap never evicts a session touched this recently. */
export const CAP_MIN_IDLE_MS = DAY_MS;

export interface InspectedWorktree {
  session_id: string;
  repo_root: string;
  project_name: string;
  branch: string;
  display_name: string | null;
  bytes: number | null;
  last_activity_at: number;
  landed_at: number | null;
  blocked_by: WorktreeCleanupGuard | null;
}

export interface CleanupPlan {
  /** Removable entries first, oldest activity first; then the protected ones. */
  entries: WorktreeCleanupEntry[];
  total_bytes: number;
}

export function planCleanup(
  worktrees: InspectedWorktree[],
  policy: WorktreeCleanupPolicy,
  now: number,
): CleanupPlan {
  const total = worktrees.reduce((sum, w) => sum + (w.bytes ?? 0), 0);
  const entries: WorktreeCleanupEntry[] = [];
  const rest: InspectedWorktree[] = [];

  for (const w of worktrees) {
    const landed =
      policy.landed_days > 0 &&
      w.landed_at !== null &&
      now - w.landed_at >= policy.landed_days * DAY_MS;
    const idle =
      policy.idle_days > 0 &&
      now - w.last_activity_at >= policy.idle_days * DAY_MS;
    if (landed || idle) {
      entries.push({ ...w, reason: landed ? "landed" : "idle" });
    } else {
      rest.push(w);
    }
  }

  if (policy.max_gb > 0) {
    let remaining =
      total -
      entries
        .filter((e) => e.blocked_by === null)
        .reduce((sum, e) => sum + (e.bytes ?? 0), 0);
    const evictable = rest
      .filter(
        (w) =>
          w.blocked_by === null &&
          (w.bytes ?? 0) > 0 &&
          now - w.last_activity_at >= CAP_MIN_IDLE_MS,
      )
      .sort((a, b) => a.last_activity_at - b.last_activity_at);
    for (const w of evictable) {
      if (remaining <= policy.max_gb * GB) {
        break;
      }
      entries.push({ ...w, reason: "over_cap" });
      remaining -= w.bytes ?? 0;
    }
  }

  entries.sort(
    (a, b) =>
      Number(a.blocked_by !== null) - Number(b.blocked_by !== null) ||
      a.last_activity_at - b.last_activity_at,
  );

  return { entries, total_bytes: total };
}

export function removable(entries: WorktreeCleanupEntry[]) {
  return entries.filter((e) => e.blocked_by === null);
}
