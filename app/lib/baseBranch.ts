/**
 * Base-branch choice for a new worktree: which branch to preselect, and which
 * ones are worth offering at all.
 */

export const COMMON_BASE_BRANCHES = [
  "staging",
  "develop",
  "dev",
  "main",
  "master",
];

/**
 * Pick the branch to preselect as the base of a new worktree.
 *
 * Priority:
 *   1. The project's `.argus.json` `default_base_branch`, then
 *      `protected_branches`, then common base-branch names. For each, prefer
 *      `origin/<name>` over the local branch when the project root has `<name>`
 *      checked out — the local copy may have drifted, so the remote tip is a
 *      more reliable base.
 *   2. The first local branch.
 */
export function pickDefaultBaseBranch(
  local: string[],
  originRefs: string[],
  configured: string | null,
  protectedBranches: string[],
  projectRootBranch: string | null,
): string | null {
  const originSet = new Set(originRefs);
  const candidates = [
    ...(configured ? [configured] : []),
    ...protectedBranches,
    ...COMMON_BASE_BRANCHES,
  ];
  const seen = new Set<string>();
  for (const name of candidates) {
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    const originRef = `origin/${name}`;
    const hasOrigin = originSet.has(originRef);
    const hasLocal = local.includes(name);
    if (hasOrigin && projectRootBranch === name) {
      return originRef;
    }
    if (hasLocal) {
      return name;
    }
    if (hasOrigin) {
      return originRef;
    }
  }

  return local[0] ?? null;
}

/**
 * Every branch worth offering as a base: the local branches, plus only the
 * `origin/*` refs of base-like branches — listing every remote ref would bury
 * the few anyone forks from.
 */
export function baseBranchOptions(
  local: string[],
  originRefs: string[],
  protectedBranches: string[],
): string[] {
  const hints = new Set([...protectedBranches, ...COMMON_BASE_BRANCHES]);
  const origins = originRefs.filter((ref) =>
    hints.has(ref.replace(/^origin\//, "")),
  );

  return [...local, ...origins];
}
