import { useEffect, useState } from "react";
import { loadBaseBranches } from "../../../lib/loadBaseBranches";

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
    loadBaseBranches(repoRoot, projectRootBranch)
      .then((loaded) => {
        if (!cancelled) {
          setState({ ...loaded, loading: false });
        }
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
