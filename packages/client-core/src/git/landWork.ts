/**
 * How the land-work card reads a session's git status: the push button, the
 * change summary and the two ways a merge into the base can go. Wording from
 * ArgusUI's `LandWorkCard`.
 */

import type { RemoteGitStatus } from "@argus/remote-protocol";

export type LandMergeStrategy = "keep" | "squash";

export const LAND_MERGE_STRATEGIES: {
  label: string;
  value: LandMergeStrategy;
}[] = [
  { value: "keep", label: "Keep every commit" },
  { value: "squash", label: "Squash into one commit" },
];

export function pushLabel(ahead: number | null | undefined): string {
  if (!ahead || ahead <= 0) {
    return "Push";
  }

  return `Push ${ahead} commit${ahead === 1 ? "" : "s"}`;
}

/** "3 changed files · +12 −4". */
export function changeSummary(
  status: Pick<
    RemoteGitStatus,
    "diff_additions" | "diff_deletions" | "dirty_count"
  >,
): string {
  const count = status.dirty_count;
  let text = count === 1 ? "1 changed file" : `${count} changed files`;
  const added = status.diff_additions ?? 0;
  const removed = status.diff_deletions ?? 0;
  if (added > 0 || removed > 0) {
    text += ` · +${added} −${removed}`;
  }

  return text;
}

/** The session's base, or a neutral word while the computer hasn't said. */
export function baseBranchLabel(base: string | null | undefined): string {
  return base?.trim() || "the base branch";
}

export function mergedNote(strategy: LandMergeStrategy, base: string): string {
  return strategy === "squash"
    ? `Squashed and merged into ${base}.`
    : `Merged into ${base}.`;
}

/** The changes line under the Changes screen's segmented control. */
export function gitStatusLine(status: RemoteGitStatus): string {
  const parts = [status.branch];
  if (status.ahead > 0) {
    parts.push(`↑${status.ahead}`);
  }
  if (status.behind > 0) {
    parts.push(`↓${status.behind}`);
  }
  parts.push(
    status.dirty_count > 0
      ? `${status.dirty_count} uncommitted`
      : "nothing uncommitted",
  );
  if (status.conflict_count > 0) {
    parts.push(`${status.conflict_count} conflicts`);
  }

  return parts.join(" · ");
}
