import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  OrganizationIcon,
} from "../../icons/Icons";
import styles from "./OrganizationCard.module.css";

export interface OrganizationCardProps extends HTMLAttributes<HTMLDivElement> {
  name: string;
  description?: string;
  /** Accent color used for the badge + hover top-border. */
  accent?: string;
  /** Short names of member repos — shown as chips. */
  members?: string[];
  taskCount?: number;
  runningCount?: number;
  /** When true, shows a chevron toggle. Children render below when expanded. */
  collapsible?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  /** Label shown next to the chevron toggle (e.g. "2 running"). */
  toggleLabel?: string;
  /** Content rendered below the card when expanded (e.g. task cards). */
  children?: ReactNode;
}

export function OrganizationCard({
  name,
  description,
  accent,
  members = [],
  taskCount = 0,
  runningCount = 0,
  collapsible = false,
  expanded = false,
  onToggle,
  toggleLabel,
  children,
  className,
  style,
  onClick,
  ...rest
}: OrganizationCardProps) {
  const mergedStyle: CSSProperties = accent
    ? ({ ...style, ["--card-accent" as string]: accent } as CSSProperties)
    : (style ?? {});

  const visibleMembers = members.slice(0, 3);
  const extra = members.length - visibleMembers.length;

  let status: string;
  if (runningCount > 0) {
    status = `${runningCount} running`;
  } else if (taskCount > 0) {
    status = `${taskCount} task${taskCount === 1 ? "" : "s"}`;
  } else {
    status = "no tasks";
  }

  return (
    <div
      className={[styles.wrap, className].filter(Boolean).join(" ")}
      style={mergedStyle}
    >
      <div className={styles.card} onClick={onClick} {...rest}>
        <div className={styles.head}>
          <div className={styles.badge}>
            <OrganizationIcon size={14} />
          </div>
          <div className={styles.name}>{name}</div>
        </div>

        {description && <div className={styles.desc}>{description}</div>}

        {members.length > 0 && (
          <div className={styles.members}>
            {visibleMembers.map((m) => (
              <span key={m} className={styles.chip}>
                {m}
              </span>
            ))}
            {extra > 0 && <span className={styles.more}>+{extra}</span>}
          </div>
        )}

        <div className={styles.foot}>
          <span
            className={[
              styles.pill,
              runningCount > 0 ? styles.live : styles.muted,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {status}
          </span>
          <span className={styles.count}>
            {members.length} {members.length === 1 ? "repo" : "repos"}
          </span>
        </div>

        {collapsible && (
          <button
            type="button"
            className={styles.expandToggle}
            aria-expanded={expanded}
            onClick={(e) => {
              e.stopPropagation();
              onToggle?.();
            }}
          >
            {expanded ? (
              <ChevronDownIcon size={11} />
            ) : (
              <ChevronRightIcon size={11} />
            )}
            <span>{toggleLabel ?? status}</span>
          </button>
        )}
      </div>

      {collapsible && expanded && children && (
        <div className={styles.children}>{children}</div>
      )}
    </div>
  );
}
