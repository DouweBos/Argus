/**
 * Phase 5 — Compare-branches view.
 *
 * Shows two columns of commits that diverge between `left` and `right`, a
 * merge-base SHA with relative age, and a conflict badge when the merge
 * would produce conflicts (best-effort via `git merge-tree`).
 */

import type { BranchCommitSummary, CompareResult } from "../../../../lib/ipc";
import { useEffect, useState } from "react";
import { Badge, GitSkeleton } from "@argus/peacock";
import { gitCompareBranches } from "../../../../lib/ipc";
import styles from "./CompareView.module.css";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) {
    return "just now";
  }
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months}mo ago`;
  }

  return `${Math.floor(months / 12)}y ago`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface CommitRowProps {
  commit: BranchCommitSummary;
}

function CommitRow({ commit }: CommitRowProps) {
  return (
    <div className={styles.commitRow}>
      <span className={styles.commitSubject}>{commit.subject}</span>
      <div className={styles.commitMeta}>
        <span className={styles.commitHash}>{commit.hash.slice(0, 7)}</span>
        <span>{commit.author}</span>
        <span>{formatRelativeTime(commit.timestamp)}</span>
      </div>
    </div>
  );
}

interface CommitColumnProps {
  commits: BranchCommitSummary[];
  label: string;
  refName: string;
}

function CommitColumn({ commits, label, refName }: CommitColumnProps) {
  return (
    <div className={styles.column}>
      <div className={styles.columnHeader}>
        {label}
        <span className={styles.columnHeaderRef}>{refName}</span>
      </div>
      <div className={styles.list}>
        {commits.length === 0 ? (
          <div className={styles.empty}>No unique commits</div>
        ) : (
          commits.map((c) => <CommitRow key={c.hash} commit={c} />)
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

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

  const mergeBaseShort = result?.mergeBase
    ? result.mergeBase.slice(0, 8)
    : null;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.refs}>
          <span className={styles.refLabel} title={left}>
            {left}
          </span>
          <span className={styles.arrow}>↔</span>
          <span className={styles.refLabel} title={right}>
            {right}
          </span>
        </div>

        <div className={styles.headerMeta}>
          {mergeBaseShort && (
            <span className={styles.mergeBase} title={result?.mergeBase ?? ""}>
              base: {mergeBaseShort}
            </span>
          )}
          {result?.wouldConflict && (
            <Badge tone="warning">Conflicts likely</Badge>
          )}
          {result && !result.mergeBase && (
            <Badge tone="neutralFilled">No common history</Badge>
          )}
        </div>
      </div>

      {loading && (
        <div className={styles.loadingWrap}>
          <GitSkeleton variant="commit-log" rows={5} />
        </div>
      )}

      {error && (
        <div className={styles.errorWrap}>
          Failed to compare branches: {error}
        </div>
      )}

      {!loading && !error && result && (
        <div className={styles.body}>
          <CommitColumn
            commits={result.leftOnly}
            label="Only in"
            refName={left}
          />
          <CommitColumn
            commits={result.rightOnly}
            label="Only in"
            refName={right}
          />
        </div>
      )}
    </div>
  );
}
