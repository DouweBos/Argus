import type { CSSProperties, ReactNode } from "react";
import { CycleIcon, EstimateIcon, PullRequestIcon } from "../../icons/Icons";
import { Avatar } from "../Avatar/Avatar";
import { IssueStatusIcon } from "../IssueStatusIcon/IssueStatusIcon";
import { PriorityIcon } from "../PriorityIcon/PriorityIcon";
import styles from "./IssueCard.module.css";

export interface IssueCardProps {
  assignee?: { avatarUrl?: string | null; name: string } | null;
  /** Shown as an accent badge, e.g. "Agent working". */
  badge?: ReactNode;
  /** The cycle's number or name, shown beside a cycle glyph. */
  cycle?: string | null;
  /** Already in the team's scale, e.g. "M" or "3". */
  estimate?: string | null;
  /** Bottom line, e.g. "Created Sep 22". */
  footnote?: ReactNode;
  identifier: string;
  /** Each with the tracker's own color for its dot. */
  labels?: { color?: string | null; name: string }[];
  onClick?: () => void;
  /** Parent issue, shown before the identifier. */
  parent?: string | null;
  priority: number;
  project?: string | null;
  pullRequestCount?: number;
  selected?: boolean;
  /** The workflow state's own color. */
  statusColor?: string | null;
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
  statusColor,
  statusType,
  title,
}: IssueCardProps) {
  const cls = [styles.card, selected && styles.selected]
    .filter(Boolean)
    .join(" ");

  return (
    // A div, not a button: buttons center their content in an anonymous box.
    <div
      className={cls}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
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
        <IssueStatusIcon color={statusColor} type={statusType} />
        <span className={styles.title}>{title}</span>
      </div>
      <div className={styles.chips}>
        <span className={styles.chip}>
          <PriorityIcon priority={priority} size={12} />
        </span>
        {cycle && (
          <span className={styles.chip}>
            <CycleIcon size={11} />
            {cycle}
          </span>
        )}
        {estimate && (
          <span className={styles.chip}>
            <EstimateIcon size={11} />
            {estimate}
          </span>
        )}
        {project && <span className={styles.chip}>{project}</span>}
        {pullRequestCount > 0 && (
          <span className={styles.chip}>
            <PullRequestIcon size={11} />
            {pullRequestCount} PR{pullRequestCount === 1 ? "" : "s"}
          </span>
        )}
        {labels.map((label) => (
          <span key={label.name} className={styles.chip}>
            <LabelDot color={label.color} />
            {label.name}
          </span>
        ))}
        {badge && <span className={styles.badge}>{badge}</span>}
      </div>
      {footnote && <div className={styles.footnote}>{footnote}</div>}
    </div>
  );
}

function LabelDot({ color }: { color?: string | null }) {
  const tint = color
    ? ({ "--label-color": color } as CSSProperties)
    : undefined;

  return <span className={styles.dot} style={tint} />;
}
