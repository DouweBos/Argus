import type { HTMLAttributes } from "react";
import { BranchIcon } from "../../icons/Icons";
import { StatusDot, type StatusTone } from "../Badge/Badge";
import { DiffStat } from "../DiffStat/DiffStat";
import styles from "./WorkspaceCard.module.css";

export interface WorkspaceCardProps extends HTMLAttributes<HTMLDivElement> {
  branch: string;
  repo?: string;
  parentBranch?: string;
  selected?: boolean;
  status?: StatusTone;
  pulse?: boolean;
  added?: number;
  removed?: number;
  files?: number;
}

export function WorkspaceCard({
  branch,
  repo,
  parentBranch,
  selected,
  status = "success",
  pulse,
  added,
  removed,
  files,
  className,
  ...rest
}: WorkspaceCardProps) {
  const classes = [
    styles.card,
    selected ? styles.selected : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} {...rest}>
      <div className={styles.top}>
        <div className={styles.left}>
          <BranchIcon size={11} />
          <span className={styles.branch}>{branch}</span>
          {(added != null || removed != null || files != null) && (
            <DiffStat added={added} removed={removed} files={files} />
          )}
        </div>
        <StatusDot tone={status} pulse={pulse} />
      </div>
      {(repo || parentBranch) && (
        <div className={styles.meta}>
          {repo}
          {repo && parentBranch ? " · " : ""}
          {parentBranch}
        </div>
      )}
    </div>
  );
}
