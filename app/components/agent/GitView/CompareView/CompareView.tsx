/**
 * Compare-branches view: the data behind Peacock's `BranchCompare`.
 */

import type { CompareResult } from "../../../../lib/ipc";
import { useEffect, useState } from "react";
import { relativeTimeMs } from "@argus/client-core";
import { BranchCompare } from "@argus/peacock";
import { gitCompareBranches } from "../../../../lib/ipc";

interface CompareViewProps {
  left: string;
  repoRoot: string;
  right: string;
  sessionId: string;
}

export function CompareView({
  sessionId,
  repoRoot: _repoRoot,
  left,
  right,
}: CompareViewProps) {
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect --
       Async data fetch — initial setState is the established Argus pattern
       for "reset to loading on dependency change". */
    setLoading(true);
    setError(null);
    setResult(null);
    /* eslint-enable react-hooks/set-state-in-effect */

    gitCompareBranches(sessionId, left, right)
      .then((r) => {
        if (!cancelled) {
          setResult(r);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, left, right]);

  return (
    <BranchCompare
      left={left}
      right={right}
      result={result}
      loading={loading}
      error={error}
      formatAge={(ts) => relativeTimeMs(ts)}
    />
  );
}
