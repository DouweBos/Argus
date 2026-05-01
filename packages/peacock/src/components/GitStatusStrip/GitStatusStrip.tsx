import type { ReactNode } from "react";
import {
  BranchIcon,
  ClockIcon,
  MergeIcon,
  WarningIcon,
} from "../../icons/Icons";
import styles from "./GitStatusStrip.module.css";

export type GitOpKind = "bisect" | "cherry-pick" | "merge" | "rebase";

export interface GitInProgressInfo {
  head: string;
  kind: GitOpKind;
  onto?: string;
  /** For rebase: optional progress like "3/12". */
  progress?: string;
}

export interface GitStatusStripProps {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  dirtyCount: number;
  stashCount: number;
  conflictCount: number;
  inProgress: GitInProgressInfo | null;
  detached: boolean;
  lastFetchAt: number | null;
  onBranchClick?: () => void;
  onOpInProgressClick?: () => void;
  onUpstreamClick?: () => void;
}

/**
 * Persistent status strip rendered at the top of the git view. Shows the
 * current branch, upstream tracking, ahead/behind counts, dirty/stash/
 * conflict counts, op-in-progress chip, and last fetch time.
 *
 * No data fetching; pure presentation. Consumers feed it from
 * `useGitStatus(sessionId)` or equivalent.
 */
export function GitStatusStrip({
  branch,
  upstream,
  ahead,
  behind,
  dirtyCount,
  stashCount,
  conflictCount,
  inProgress,
  detached,
  lastFetchAt,
  onBranchClick,
  onOpInProgressClick,
  onUpstreamClick,
}: GitStatusStripProps) {
  return (
    <div className={styles.strip} role="status">
      <div className={styles.left}>
        {detached ? (
          <Chip
            tone="warning"
            leading={<WarningIcon size={11} />}
            title="HEAD is detached"
          >
            <span className={styles.branchName}>detached @ {branch}</span>
          </Chip>
        ) : (
          <Chip
            leading={<BranchIcon size={11} />}
            interactive={Boolean(onBranchClick)}
            onClick={onBranchClick}
            title={onBranchClick ? "Branch options" : undefined}
          >
            <span className={styles.branchName}>{branch}</span>
          </Chip>
        )}

        <UpstreamChip upstream={upstream} onClick={onUpstreamClick} />

        {(ahead > 0 || behind > 0) && (
          <span className={styles.aheadBehind} aria-label="ahead-behind">
            {ahead > 0 && (
              <span
                className={styles.ahead}
                title={`${ahead} ahead of upstream`}
              >
                <span className={styles.arrow}>↑</span>
                {ahead}
              </span>
            )}
            {behind > 0 && (
              <span
                className={styles.behind}
                title={`${behind} behind upstream`}
              >
                <span className={styles.arrow}>↓</span>
                {behind}
              </span>
            )}
          </span>
        )}

        {(dirtyCount > 0 || stashCount > 0) && (
          <span className={styles.groupDivider} role="separator" />
        )}

        {dirtyCount > 0 && (
          <Chip
            title={`${dirtyCount} changed file${dirtyCount === 1 ? "" : "s"}`}
          >
            {dirtyCount} changed
          </Chip>
        )}

        {stashCount > 0 && (
          <Chip
            muted
            title={`${stashCount} stash${stashCount === 1 ? "" : "es"}`}
          >
            {stashCount} stash{stashCount === 1 ? "" : "es"}
          </Chip>
        )}

        {conflictCount > 0 && (
          <Chip
            tone="error"
            interactive={Boolean(onOpInProgressClick)}
            onClick={onOpInProgressClick}
            leading={<WarningIcon size={11} />}
            title={`${conflictCount} conflicted file${conflictCount === 1 ? "" : "s"}`}
          >
            {conflictCount} conflict{conflictCount === 1 ? "" : "s"}
          </Chip>
        )}

        {inProgress && (
          <Chip
            tone="accent"
            interactive={Boolean(onOpInProgressClick)}
            onClick={onOpInProgressClick}
            leading={<MergeIcon size={11} />}
            title="Open conflicts view"
          >
            {opLabel(inProgress)}
          </Chip>
        )}
      </div>

      <div className={styles.right}>
        <span className={styles.fetchTime}>
          <ClockIcon size={10} /> {formatFetch(lastFetchAt)}
        </span>
      </div>
    </div>
  );
}

interface ChipProps {
  children: ReactNode;
  leading?: ReactNode;
  tone?: "accent" | "default" | "error" | "warning";
  muted?: boolean;
  interactive?: boolean;
  onClick?: () => void;
  title?: string;
}

function Chip({
  children,
  leading,
  tone = "default",
  muted,
  interactive,
  onClick,
  title,
}: ChipProps) {
  const classes = [
    styles.chip,
    tone === "warning" ? styles.warning : "",
    tone === "error" ? styles.error : "",
    tone === "accent" ? styles.accent : "",
    muted ? styles.muted : "",
    interactive ? styles.interactive : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (interactive && onClick) {
    return (
      <button type="button" className={classes} onClick={onClick} title={title}>
        {leading}
        {children}
      </button>
    );
  }

  return (
    <span className={classes} title={title}>
      {leading}
      {children}
    </span>
  );
}

function UpstreamChip({
  upstream,
  onClick,
}: {
  upstream: string | null;
  onClick?: () => void;
}) {
  if (upstream) {
    return (
      <Chip muted title={`Tracking ${upstream}`}>
        <span className={styles.branchName}>{upstream}</span>
      </Chip>
    );
  }

  return (
    <Chip
      muted
      interactive={Boolean(onClick)}
      onClick={onClick}
      title={onClick ? "Publish branch to remote" : "No upstream configured"}
    >
      no upstream
    </Chip>
  );
}

function opLabel(op: GitInProgressInfo): string {
  const head = op.head;
  const onto = op.onto;
  switch (op.kind) {
    case "merge":
      return onto
        ? `Merge in progress: ${head} ← ${onto}`
        : `Merge in progress: ${head}`;
    case "rebase":
      return op.progress
        ? `Rebase ${op.progress}`
        : `Rebase in progress: ${head}${onto ? ` onto ${onto}` : ""}`;
    case "cherry-pick":
      return `Cherry-pick in progress`;
    case "bisect":
      return `Bisect in progress`;
  }
}

function formatFetch(ms: number | null): string {
  if (ms == null) {
    return "never fetched";
  }
  const diffMs = Date.now() - ms;
  if (diffMs < 0) {
    return "fetched just now";
  }
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) {
    return "fetched just now";
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `fetched ${min}m ago`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return `fetched ${hr}h ago`;
  }
  const day = Math.floor(hr / 24);

  return `fetched ${day}d ago`;
}
