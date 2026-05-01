import type { ButtonHTMLAttributes, MouseEventHandler, ReactNode } from "react";
import { BranchIcon, ChevronDownIcon } from "../../icons/Icons";
import { Badge } from "../Badge/Badge";
import styles from "./SidebarBranchRow.module.css";

export interface SidebarBranchRowProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "title"
> {
  /** Display name (the leaf segment for grouped branches, full name otherwise). */
  name: string;
  /** Tooltip — usually the full branch name. */
  title?: string;
  /** HEAD points at this branch. Renders the HEAD chip; selection styling is
   * applied separately via `selected` so the user's chosen row stays
   * highlighted even when HEAD is on a different branch. */
  current?: boolean;
  /** User has selected this row (e.g. it's the branch driving the History
   * view). Renders the highlighted background + accent text. */
  selected?: boolean;
  /** Commits ahead of upstream. Renders as `↑n`. */
  ahead?: number;
  /** Commits behind upstream. Renders as `↓n`. */
  behind?: number;
  /** Open PR number associated with this branch — renders as `#1234`. */
  prNumber?: number;
  /** Visual indent level when nested under a folder. */
  depth?: number;
  /** Replace the default branch-fork glyph (e.g. for archived/dim variants). */
  leading?: ReactNode;
  /** Optional node appended inside the trailing cluster (e.g. a pin indicator). */
  trailing?: ReactNode;
  /** Right-click handler — used for "Archive Branch" / "Checkout" menus. */
  onContextMenu?: MouseEventHandler<HTMLButtonElement>;
}

/**
 * Flat branch row for the project-scope git sidebar.
 *
 * One row per branch — small fork glyph + name + optional ahead/behind cluster
 * + optional PR badge + HEAD chip. Replaces the previous orange `RefBadge`
 * pill treatment which read as too loud at sidebar density.
 */
export function SidebarBranchRow({
  name,
  title,
  current,
  selected,
  ahead,
  behind,
  prNumber,
  depth = 0,
  leading,
  trailing,
  className,
  type = "button",
  onContextMenu,
  ...rest
}: SidebarBranchRowProps) {
  const classes = [
    styles.row,
    selected ? styles.selected : "",
    current ? styles.current : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const showAB = Boolean((ahead && ahead > 0) || (behind && behind > 0));

  return (
    <button
      type={type}
      className={classes}
      title={title ?? name}
      onContextMenu={onContextMenu}
      style={
        depth > 0
          ? { paddingLeft: `calc(${depth} * var(--space-4) + var(--space-3))` }
          : undefined
      }
      {...rest}
    >
      <span className={styles.leading}>
        {leading ?? <BranchIcon size={11} />}
      </span>
      <span className={styles.name}>{name}</span>
      {prNumber != null && <span className={styles.pr}>#{prNumber}</span>}
      {(showAB || current || trailing) && (
        <span className={styles.trailing}>
          {trailing}
          {current && (
            <Badge tone="accent" size="tag" className={styles.headBadge}>
              HEAD
            </Badge>
          )}
          {showAB && (
            <span className={styles.aheadBehind}>
              {ahead && ahead > 0 ? <span>↑{ahead}</span> : null}
              {behind && behind > 0 ? <span>↓{behind}</span> : null}
            </span>
          )}
        </span>
      )}
    </button>
  );
}

export interface SidebarBranchFolderProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  name: string;
  /** Visual indent level when nested. */
  depth?: number;
  collapsed?: boolean;
}

/** Folder header row matching the SidebarBranchRow visual cadence. */
export function SidebarBranchFolder({
  name,
  depth = 0,
  collapsed,
  className,
  type = "button",
  ...rest
}: SidebarBranchFolderProps) {
  const classes = [styles.folder, className ?? ""].filter(Boolean).join(" ");

  return (
    <button
      type={type}
      className={classes}
      style={
        depth > 0
          ? { paddingLeft: `calc(${depth} * var(--space-4) + var(--space-3))` }
          : undefined
      }
      aria-expanded={!collapsed}
      {...rest}
    >
      <span
        className={[styles.chevron, collapsed ? styles.chevronCollapsed : ""]
          .filter(Boolean)
          .join(" ")}
        aria-hidden="true"
      >
        <ChevronDownIcon size={12} />
      </span>
      <span className={styles.folderName}>{name}</span>
    </button>
  );
}
