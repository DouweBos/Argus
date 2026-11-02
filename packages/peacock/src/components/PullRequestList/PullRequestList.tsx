import type { ReactNode } from "react";
import { AgentIcon, BranchIcon, CheckIcon } from "../../icons/Icons";
import { Badge, type BadgeTone } from "../Badge/Badge";
import { Card } from "../Card/Card";
import { Chip } from "../Chip/Chip";
import { GridScreen } from "../GridScreen/GridScreen";
import styles from "./PullRequestList.module.css";

export interface PullRequestTag {
  label: string;
  tone: BadgeTone;
}

/** One PR as the list shows it, whichever shape the client holds it in. */
export interface PullRequestRowModel {
  title: string;
  /** `owner/repo`. */
  repo: string;
  number: number;
  author: string | null;
  avatarUrl?: string | null;
  isDraft: boolean;
  /** "3h ago". */
  updated: string;
  headRef: string;
  /** Why it is in your list: Author, Reviewer, … */
  reasons: PullRequestTag[];
  review?: PullRequestTag | null;
}

export interface PullRequestRowProps {
  pr: PullRequestRowModel;
  onOpen: () => void;
  /** Buttons beside the row: open in browser, start a session, … */
  actions?: ReactNode;
}

/** One PR in the list: what it is, its review state, and why you're seeing it. */
export function PullRequestRow({ pr, onOpen, actions }: PullRequestRowProps) {
  return (
    <Card hoverable className={styles.row}>
      <div
        className={styles.rowMain}
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            onOpen();
          }
        }}
      >
        <div className={styles.rowHead}>
          {pr.avatarUrl ? (
            <img alt="" className={styles.avatar} src={pr.avatarUrl} />
          ) : (
            <span className={styles.avatarFallback}>
              <AgentIcon size={12} />
            </span>
          )}
          <div className={styles.rowTitleBlock}>
            <div className={styles.rowTitleLine}>
              <span className={styles.title}>{pr.title}</span>
              {pr.isDraft && (
                <Badge tone="neutral" size="tag">
                  Draft
                </Badge>
              )}
              {pr.review && (
                <Badge tone={pr.review.tone} size="tag">
                  {pr.review.label}
                </Badge>
              )}
            </div>
            <div className={styles.meta}>
              <span className={styles.repo}>{pr.repo}</span>
              <span className={styles.metaSep}>·</span>
              <span>#{pr.number}</span>
              <span className={styles.metaSep}>·</span>
              <span>{pr.author ? `by ${pr.author}` : "unknown author"}</span>
              <span className={styles.metaSep}>·</span>
              <span>updated {pr.updated}</span>
            </div>
          </div>
        </div>
        <div className={styles.chips}>
          {pr.reasons.map((reason) => (
            <Badge key={reason.label} tone={reason.tone} size="tag">
              {reason.label}
            </Badge>
          ))}
          <Chip
            muted
            mono
            className={styles.branchChip}
            leading={<BranchIcon size={10} />}
          >
            {pr.headRef}
          </Chip>
        </div>
      </div>
      {actions && <div className={styles.rowActions}>{actions}</div>}
    </Card>
  );
}

export interface PullRequestBucketView {
  /** Stable key: the bucket id. */
  id: string;
  title: string;
  /** Needs the viewer now; the rest sit behind the "No immediate action" divider. */
  attention: boolean;
  /** The rows, already sorted. */
  rows: ReactNode[];
}

export interface PullRequestBucketsProps {
  buckets: PullRequestBucketView[];
}

function Bucket({ bucket }: { bucket: PullRequestBucketView }) {
  return (
    <GridScreen.Section title={bucket.title} count={bucket.rows.length}>
      <GridScreen.Grid>{bucket.rows}</GridScreen.Grid>
    </GridScreen.Section>
  );
}

/**
 * PRs bucketed by what they need from you: the attention buckets first (or an
 * all-clear), then the quiet ones, dimmed behind a divider.
 */
export function PullRequestBuckets({ buckets }: PullRequestBucketsProps) {
  const attention = buckets.filter((b) => b.attention && b.rows.length > 0);
  const quiet = buckets.filter((b) => !b.attention && b.rows.length > 0);
  const quietCount = quiet.reduce((sum, b) => sum + b.rows.length, 0);

  return (
    <>
      {attention.length === 0 ? (
        <Card className={styles.allClear}>
          <CheckIcon size={14} />
          <span>Nothing waiting on you right now.</span>
        </Card>
      ) : (
        attention.map((b) => <Bucket key={b.id} bucket={b} />)
      )}

      {quiet.length > 0 && (
        <>
          <div className={styles.quietDivider}>
            <span className={styles.quietDividerLabel}>
              No immediate action
            </span>
            <span className={styles.quietDividerCount}>
              {quietCount} PR{quietCount === 1 ? "" : "s"}
            </span>
            <span className={styles.quietDividerRule} />
          </div>
          <div className={styles.quietBlock}>
            {quiet.map((b) => (
              <Bucket key={b.id} bucket={b} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
