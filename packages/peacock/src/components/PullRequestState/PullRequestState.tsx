import type { MouseEvent } from "react";
import { PullRequestIcon } from "../../icons/Icons";
import styles from "./PullRequestState.module.css";

export type PullRequestStateKind = "closed" | "draft" | "merged" | "open";

const LABELS: Record<PullRequestStateKind, string> = {
  closed: "Closed",
  draft: "Draft",
  merged: "Merged",
  open: "Open",
};

/** "Pull request #123 · Merged". */
export function pullRequestStateLabel(
  number: number,
  state: PullRequestStateKind,
): string {
  return `Pull request #${number} · ${LABELS[state]}`;
}

export interface PullRequestStateProps {
  className?: string;
  number: number;
  /** Makes the icon a button; the click doesn't reach the row beneath it. */
  onOpen?: () => void;
  size?: number;
  state: PullRequestStateKind;
}

/** GitHub's pull request icon, coloured by where the PR stands. */
export function PullRequestState({
  number,
  state,
  onOpen,
  size = 12,
  className,
}: PullRequestStateProps) {
  const label = pullRequestStateLabel(number, state);
  const classes = [styles.root, styles[state], className ?? ""]
    .filter(Boolean)
    .join(" ");

  if (!onOpen) {
    return (
      <span className={classes} role="img" aria-label={label} title={label}>
        <PullRequestIcon size={size} />
      </span>
    );
  }

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onOpen();
  };

  return (
    <button
      type="button"
      className={`${classes} ${styles.button}`}
      aria-label={label}
      title={label}
      onClick={handleClick}
    >
      <PullRequestIcon size={size} />
    </button>
  );
}
