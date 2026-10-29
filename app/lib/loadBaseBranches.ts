import { baseBranchOptions, pickDefaultBaseBranch } from "./baseBranch";
import { listAllBranches, readArgusConfig } from "./ipc";

export interface LoadedBaseBranches {
  /** Preselected base; null when the list is empty. */
  defaultBranch: string | null;
  options: string[];
}

/** The branches a new worktree in `repoRoot` can start from, and the one to preselect. */
export async function loadBaseBranches(
  repoRoot: string,
  projectRootBranch: string | null,
): Promise<LoadedBaseBranches> {
  const [list, config] = await Promise.all([
    listAllBranches(repoRoot),
    readArgusConfig(repoRoot).catch(() => null),
  ]);
  const originRefs = list.originRefs ?? [];
  const protectedBranches = config?.protected_branches ?? [];

  return {
    defaultBranch: pickDefaultBaseBranch(
      list.local,
      originRefs,
      config?.default_base_branch?.trim() || null,
      protectedBranches,
      projectRootBranch,
    ),
    options: baseBranchOptions(list.local, originRefs, protectedBranches),
  };
}
