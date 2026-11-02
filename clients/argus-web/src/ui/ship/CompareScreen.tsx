/** `/sessions/:id/git/compare?left=&right=`: where two branches diverged. */

import type { RemoteBranchCompare } from "@argus/remote-protocol";
import { useEffect, useState } from "react";
import { describeError, relativeTimeMs } from "@argus/client-core";
import { BranchCompare } from "@argus/peacock";
import { appNavigate } from "../../routing/router";
import { compareBranches } from "../../stores/branches";
import { useConnectionStore } from "../../stores/connection";

export function CompareScreen({
  left,
  right,
  sessionId,
}: {
  left: string;
  right: string;
  sessionId: string;
}) {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const [result, setResult] = useState<RemoteBranchCompare | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) {
      return;
    }
    let cancelled = false;
    compareBranches(sessionId, left, right)
      .then((r) => {
        if (!cancelled) {
          setResult(r);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(describeError(err));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [ready, sessionId, left, right]);

  return (
    <div className="aw-ship aw-ship-compare">
      <BranchCompare
        left={left}
        right={right}
        loading={result === null && error === null}
        error={error}
        formatAge={(ts) => relativeTimeMs(ts)}
        result={
          result && {
            leftOnly: result.left_only,
            rightOnly: result.right_only,
            mergeBase: result.merge_base,
            wouldConflict: result.would_conflict,
          }
        }
        onOpenCommit={(c) =>
          appNavigate({ name: "commit", sessionId, hash: c.hash })
        }
      />
    </div>
  );
}
