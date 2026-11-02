import type { ReactNode } from "react";
import {
  BranchIcon,
  CheckIcon,
  MergeIcon,
  PullRequestIcon,
  PushIcon,
} from "../../icons/Icons";
import { Banner } from "../Banner/Banner";
import { Button } from "../Button/Button";
import { Card } from "../Card/Card";
import { Chip } from "../Chip/Chip";
import styles from "./LandWorkCard.module.css";

export type LandWorkBusy = "commit" | "merge" | "push" | null;

export interface LandWorkCardProps {
  branch: string;
  /** Where a merge lands, or a neutral word while it isn't known. */
  base: string;
  /** Makes the branch chip change the base. */
  onChangeBase?: () => void;
  /** What the last action did ("Pushed x to origin."). */
  note?: ReactNode;
  /** No uncommitted changes: shows "Working tree clean" instead of `children`. */
  clean: boolean;
  /** The commit form, shown while there is something to commit. */
  children?: ReactNode;
  /** Why a merge would be refused; the merge button stays off while any are. */
  blockers?: string[];
  /** "Push 2 commits". */
  pushLabel: string;
  onPush: () => void;
  onOpenPullRequest?: () => void;
  onMerge: () => void;
  busy?: LandWorkBusy;
}

/**
 * Commit, push and merge a session's branch: the end of the loop. Every
 * action only asks — the computer still refuses a protected base or a
 * conflicting merge.
 */
export function LandWorkCard({
  branch,
  base,
  onChangeBase,
  note,
  clean,
  children,
  blockers = [],
  pushLabel,
  onPush,
  onOpenPullRequest,
  onMerge,
  busy = null,
}: LandWorkCardProps) {
  const working = busy !== null;
  const blocked = blockers.length > 0;

  return (
    <Card className={styles.card} stack>
      <div className={styles.header}>
        <span className={styles.title}>Land this work</span>
        <Chip
          mono
          className={styles.route}
          leading={<BranchIcon size={10} />}
          interactive={Boolean(onChangeBase) && !working}
          role={onChangeBase ? "button" : undefined}
          tabIndex={onChangeBase && !working ? 0 : undefined}
          title={onChangeBase ? "Change the base branch" : undefined}
          onClick={working ? undefined : onChangeBase}
          onKeyDown={(e) => {
            if (onChangeBase && !working && e.key === "Enter") {
              onChangeBase();
            }
          }}
        >
          {branch} → {base}
        </Chip>
      </div>

      {note && <div className={styles.note}>{note}</div>}

      {clean ? (
        <div className={styles.clean}>
          <CheckIcon size={11} className={styles.cleanIcon} />
          Working tree clean
        </div>
      ) : (
        children
      )}

      {blockers.map((blocker) => (
        <Banner key={blocker} tone="warning">
          {blocker}
        </Banner>
      ))}

      <div className={styles.divider} />

      <div className={styles.actions}>
        <Button
          variant="secondary"
          size="sm"
          leading={<PushIcon size={12} />}
          disabled={working}
          onClick={onPush}
        >
          {busy === "push" ? "Pushing…" : pushLabel}
        </Button>
        {onOpenPullRequest && (
          <Button
            variant="secondary"
            size="sm"
            leading={<PullRequestIcon size={12} />}
            disabled={working}
            onClick={onOpenPullRequest}
          >
            Open pull request
          </Button>
        )}
        <span className={styles.spacer} />
        {/* The way out once everything is committed, so it leads then. */}
        <Button
          variant={clean && !blocked ? "primary" : "secondary"}
          size="sm"
          leading={<MergeIcon size={12} />}
          disabled={working || blocked}
          onClick={onMerge}
        >
          {busy === "merge" ? "Merging…" : `Merge into ${base}`}
        </Button>
      </div>
    </Card>
  );
}
