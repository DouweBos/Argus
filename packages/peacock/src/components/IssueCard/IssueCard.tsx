import type { ReactNode } from "react";
import { Avatar } from "../Avatar/Avatar";
import { IssueStatusIcon } from "../IssueStatusIcon/IssueStatusIcon";
import { PriorityIcon } from "../PriorityIcon/PriorityIcon";
import styles from "./IssueCard.module.css";

export interface IssueCardProps {
  assignee?: { avatarUrl?: string | null; name: string } | null;
  /** Shown as an accent badge, e.g. "Agent working". */
  badge?: ReactNode;
  /** e.g. "Cycle 59". */
  cycle?: string | null;
  estimate?: number | null;
  /** Bottom line, e.g. "Created Sep 22". */
  footnote?: ReactNode;
  identifier: string;
  labels?: string[];
  onClick?: () => void;
  /** Parent issue, shown before the identifier. */
  parent?: string | null;
  priority: number;
  project?: string | null;
  pullRequestCount?: number;
  selected?: boolean;
  statusType: string;
  title: string;
}

/** One tracker issue on a board: the line a person scans to decide what's next. */
export function IssueCard({
  assignee,
  badge,
  cycle,
  estimate,
  footnote,
  identifier,
  labels = [],
  onClick,
  parent,
  priority,
  project,
  pullRequestCount = 0,
  selected = false,
  statusType,
  title,
}: IssueCardProps) {
  const cls = [styles.card, selected && styles.selected]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={cls} type="button" onClick={onClick}>
      <div className={styles.head}>
        <span className={styles.identifier}>
          {parent ? `${parent} › ` : ""}
          {identifier}
        </span>
        {assignee && (
          <Avatar
            className={styles.avatar}
            name={assignee.name}
            size={18}
            src={assignee.avatarUrl}
          />
        )}
      </div>
      <div className={styles.titleLine}>
        <IssueStatusIcon type={statusType} />
        <span className={styles.title}>{title}</span>
      </div>
      <div className={styles.chips}>
        <span className={styles.chip}>
          <PriorityIcon priority={priority} size={12} />
        </span>
        {estimate != null && <span className={styles.chip}>{estimate} pt</span>}
        {cycle && <span className={styles.chip}>{cycle}</span>}
        {project && <span className={styles.chip}>{project}</span>}
        {pullRequestCount > 0 && (
          <span className={styles.chip}>
            {pullRequestCount} PR{pullRequestCount === 1 ? "" : "s"}
          </span>
        )}
        {labels.map((label) => (
          <span key={label} className={styles.chip}>
            {label}
          </span>
        ))}
        {badge && <span className={styles.badge}>{badge}</span>}
      </div>
      {footnote && <div className={styles.footnote}>{footnote}</div>}
    </button>
  );
}
