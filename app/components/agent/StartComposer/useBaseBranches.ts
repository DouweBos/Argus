import { useEffect, useState } from "react";
import {
  baseBranchOptions,
  pickDefaultBaseBranch,
} from "../../../lib/baseBranch";
import { listAllBranches, readArgusConfig } from "../../../lib/ipc";

interface BaseBranches {
  /** Preselected base; null until the branch list loads (or when it's empty). */
  defaultBranch: string | null;
  loading: boolean;
  options: string[];
}

/**
 * The branches a new worktree can start from. Only fetched once `enabled` —
 * a prompt aimed at the current checkout never needs them.
 */
export function useBaseBranches(
  repoRoot: string | null,
  projectRootBranch: string | null,
  enabled: boolean,
): BaseBranches {
  const [state, setState] = useState<BaseBranches>({
    defaultBranch: null,
    loading: true,
    options: [],
  });

  useEffect(() => {
    if (!repoRoot || !enabled) {
      return;
    }
    let cancelled = false;
    Promise.all([
      listAllBranches(repoRoot),
      readArgusConfig(repoRoot).catch(() => null),
    ])
      .then(([list, config]) => {
        if (cancelled) {
          return;
        }
        const originRefs = list.originRefs ?? [];
        const protectedBranches = config?.protected_branches ?? [];
        setState({
          defaultBranch: pickDefaultBaseBranch(
            list.local,
            originRefs,
            config?.default_base_branch?.trim() || null,
            protectedBranches,
            projectRootBranch,
          ),
          loading: false,
          options: baseBranchOptions(list.local, originRefs, protectedBranches),
        });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ defaultBranch: null, loading: false, options: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repoRoot, projectRootBranch, enabled]);

  return state;
}
