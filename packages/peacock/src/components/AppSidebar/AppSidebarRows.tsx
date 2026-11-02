import type { KeyboardEvent, ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from "../../icons/Icons";
import { StatusDot, type StatusTone } from "../Badge/Badge";
import { FlatIconButton } from "../FlatIconButton/FlatIconButton";
import { ProjectBadge } from "../ProjectBadge/ProjectBadge";
import styles from "./AppSidebar.module.css";

/** Enter and Space activate a row that holds buttons of its own. */
function activateOnKey(action?: () => void) {
  return (e: KeyboardEvent) => {
    if (action && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      action();
    }
  };
}

export interface AppSidebarProjectHeaderProps {
  name: string;
  /** The repo root: colours the badge, and the tooltip. */
  projectKey: string;
  /** The root checkout's branch, right-aligned. */
  branch?: string;
  ahead?: number;
  behind?: number;
  /** A dot beside the branch while the root checkout's agents work. */
  status?: StatusTone;
  busy?: boolean;
  /** The root checkout is the session on screen. */
  selected?: boolean;
  /** Its drive is unplugged or the checkout errored. */
  unavailable?: boolean;
  /** Sessions are folded away; null when it has none to fold. */
  collapsed?: boolean | null;
  onToggleCollapsed?: () => void;
  onNewSession?: () => void;
  onClick?: () => void;
  /** Extra marks after the name (host, drive). */
  marks?: ReactNode;
}

/**
 * A project in the sidebar: badge, name, sync counts, and its root checkout's
 * branch. On hover the badge becomes the fold chevron and the branch a `+`.
 */
export function AppSidebarProjectHeader({
  name,
  projectKey,
  branch,
  ahead = 0,
  behind = 0,
  status,
  busy,
  selected,
  unavailable,
  collapsed,
  onToggleCollapsed,
  onNewSession,
  onClick,
  marks,
}: AppSidebarProjectHeaderProps) {
  const foldable = collapsed != null && onToggleCollapsed;

  return (
    <div
      aria-current={selected ? "page" : undefined}
      className={[styles.row, styles.projectHeader].join(" ")}
      data-selected={selected || undefined}
      data-unavailable={unavailable || undefined}
      role="button"
      tabIndex={0}
      title={projectKey}
      onClick={onClick}
      onKeyDown={activateOnKey(onClick)}
    >
      <span className={styles.lead}>
        <ProjectBadge
          className={foldable ? styles.badgeFoldable : undefined}
          name={name}
          projectKey={projectKey}
        />
        {foldable && (
          <button
            aria-label={collapsed ? `Expand ${name}` : `Collapse ${name}`}
            className={styles.fold}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapsed();
            }}
          >
            {collapsed ? (
              <ChevronRightIcon size={10} />
            ) : (
              <ChevronDownIcon size={10} />
            )}
          </button>
        )}
      </span>
      <span className={styles.projectName}>{name}</span>
      {marks}
      {(ahead > 0 || behind > 0) && (
        <span className={styles.sync}>
          {behind > 0 && <span className={styles.behind}>↓{behind}</span>}
          {ahead > 0 && <span>↑{ahead}</span>}
        </span>
      )}
      <span className={styles.spacer} />
      {branch && (
        <span
          className={styles.branch}
          data-hover-hide={onNewSession ? "" : undefined}
        >
          {status && <StatusDot pulse={busy} tone={status} />}
          <span className={styles.branchName}>{branch}</span>
        </span>
      )}
      {onNewSession && (
        <FlatIconButton
          className={styles.hoverAction}
          icon={<PlusIcon size={11} />}
          label={`New session in ${name}`}
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onNewSession();
          }}
        />
      )}
    </div>
  );
}

export interface AppSidebarSessionRowProps {
  title: string;
  /** The branch, when the title doesn't already say it. */
  subtitle?: string;
  status?: StatusTone;
  busy?: boolean;
  /** "now", "5m", "3d": how long since anything happened. */
  age?: string;
  selected?: boolean;
  unavailable?: boolean;
  /** A trailing note instead of the age, e.g. "Waiting" or "Setting up". */
  note?: string;
  onClick?: () => void;
  tooltip?: string;
}

/** A session under its project: a status dot, its title, and how old it is. */
export function AppSidebarSessionRow({
  title,
  subtitle,
  status,
  busy,
  age,
  selected,
  unavailable,
  note,
  onClick,
  tooltip,
}: AppSidebarSessionRowProps) {
  return (
    <button
      aria-current={selected ? "page" : undefined}
      className={[styles.row, styles.sessionRow].join(" ")}
      data-selected={selected || undefined}
      data-unavailable={unavailable || undefined}
      disabled={unavailable}
      title={tooltip ?? title}
      type="button"
      onClick={onClick}
    >
      <span className={styles.lead}>
        {status ? (
          <StatusDot pulse={busy} tone={status} />
        ) : (
          <span className={styles.idleDot} />
        )}
      </span>
      <span className={styles.sessionText}>
        <span className={styles.sessionTitle}>{title}</span>
        {subtitle && <span className={styles.sessionSubtitle}>{subtitle}</span>}
      </span>
      {(note ?? age) && <span className={styles.age}>{note ?? age}</span>}
    </button>
  );
}
