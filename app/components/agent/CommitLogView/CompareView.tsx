/**
 * Phase 4 H4 — compare any two commits side-by-side.
 *
 * Used when `gitUiStore.comparisonRange` is set (Cmd+Click in
 * `CommitLogView` after a commit is selected). Renders a header with the
 * two endpoints + Swap / Close, then a file list with inline diffs powered
 * by existing `FileDiffView`.
 */

import { useEffect, useState } from "react";
import { Button, GitErrorBanner, GitSkeleton, Icons } from "@argus/peacock";
import { parseDiff, type DiffFile } from "../../../lib/diffParser";
import { gitDiffRange } from "../../../lib/ipc";
import {
  clearComparisonRange,
  setComparisonRange,
} from "../../../stores/gitUiStore";
import { FileDiffView } from "../FileDiffView";
import styles from "./CompareView.module.css";

export interface CompareViewProps {
  fromRef: string;
  sessionId: string;
  toRef: string;
}

export function CompareView({ sessionId, fromRef, toRef }: CompareViewProps) {
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect --
       Async data fetch — initial setState is the established Argus pattern
       for "reset to loading on dependency change". */
    setLoading(true);
    setError(null);
    setFiles([]);
    setExpandedIdx(new Set());
    /* eslint-enable react-hooks/set-state-in-effect */
    gitDiffRange(sessionId, fromRef, toRef)
      .then((res) => {
        if (cancelled) {
          return;
        }
        const parsed: DiffFile[] = [];
        for (const f of res.files) {
          if (!f.patch) {
            continue;
          }
          const ds = parseDiff(f.patch);
          for (const d of ds) {
            parsed.push(d);
          }
        }
        setFiles(parsed);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, fromRef, toRef]);

  const swap = (): void => {
    setComparisonRange({ from: toRef, to: fromRef });
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.endpoints}>
          <span className={styles.ref}>{fromRef.slice(0, 7)}</span>
          <Icons.ArrowForwardIcon size={12} />
          <span className={styles.ref}>{toRef.slice(0, 7)}</span>
        </div>
        <div className={styles.actions}>
          <Button size="sm" variant="ghost" onClick={swap}>
            Swap
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => clearComparisonRange()}
          >
            Close
          </Button>
        </div>
      </div>

      {loading && <GitSkeleton variant="file-list" rows={4} />}
      {error && <GitErrorBanner kind="unknown" message={error} />}
      {!loading && !error && files.length === 0 && (
        <div className={styles.empty}>No differences between commits</div>
      )}

      <div className={styles.files}>
        {files.map((f, i) => {
          const path = f.newPath || f.oldPath;
          const expanded = expandedIdx.has(i);

          return (
            <div key={`${path}-${i}`} className={styles.fileBlock}>
              <button
                className={styles.fileHeader}
                onClick={() =>
                  setExpandedIdx((cur) => {
                    const next = new Set(cur);
                    if (next.has(i)) {
                      next.delete(i);
                    } else {
                      next.add(i);
                    }

                    return next;
                  })
                }
              >
                {expanded ? (
                  <Icons.ChevronDownIcon size={10} />
                ) : (
                  <Icons.ChevronRightIcon size={8} />
                )}
                <span className={styles.fileStatus}>{f.status}</span>
                <span className={styles.filePath}>{path}</span>
              </button>
              {expanded && (
                <FileDiffView
                  file={f}
                  inline
                  readOnly
                  sessionId={sessionId}
                  onAction={async () => undefined}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
