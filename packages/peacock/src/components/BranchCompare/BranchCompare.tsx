import { Badge } from "../Badge/Badge";
import { CommitRow } from "../CommitRow/CommitRow";
import { GitSkeleton } from "../GitSkeleton/GitSkeleton";
import styles from "./BranchCompare.module.css";

export interface BranchCompareCommit {
  hash: string;
  subject: string;
  author: string;
  /** Unix ms. */
  timestamp: number;
}

export interface BranchCompareResult {
  leftOnly: BranchCompareCommit[];
  rightOnly: BranchCompareCommit[];
  mergeBase: string | null;
  /** Best-effort: a trial merge saw conflicts. */
  wouldConflict: boolean;
}

export interface BranchCompareProps {
  left: string;
  right: string;
  result: BranchCompareResult | null;
  loading?: boolean;
  error?: string | null;
  /** Words a commit's age; the caller owns the clock. */
  formatAge: (timestamp: number) => string;
  /** Makes each commit open, e.g. its diff. */
  onOpenCommit?: (commit: BranchCompareCommit) => void;
}

function CommitColumn({
  commits,
  formatAge,
  onOpenCommit,
  refName,
}: {
  commits: BranchCompareCommit[];
  formatAge: (timestamp: number) => string;
  onOpenCommit?: (commit: BranchCompareCommit) => void;
  refName: string;
}) {
  return (
    <div className={styles.column}>
      <div className={styles.columnHeader}>
        Only in
        <span className={styles.columnHeaderRef}>{refName}</span>
      </div>
      <div className={styles.list}>
        {commits.length === 0 ? (
          <div className={styles.empty}>No unique commits</div>
        ) : (
          commits.map((c) => (
            <CommitRow
              key={c.hash}
              subject={c.subject}
              hash={c.hash}
              author={c.author}
              age={formatAge(c.timestamp)}
              onClick={onOpenCommit ? () => onOpenCommit(c) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Where two branches diverged: the merge base, whether a merge would
 * conflict, and the commits only one side has.
 */
export function BranchCompare({
  left,
  right,
  result,
  loading = false,
  error = null,
  formatAge,
  onOpenCommit,
}: BranchCompareProps) {
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
            refName={left}
            formatAge={formatAge}
            onOpenCommit={onOpenCommit}
          />
          <CommitColumn
            commits={result.rightOnly}
            refName={right}
            formatAge={formatAge}
            onOpenCommit={onOpenCommit}
          />
        </div>
      )}
    </div>
  );
}
