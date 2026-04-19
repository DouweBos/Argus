import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { ChevronDownIcon } from "../../icons/Icons";
import { StatusDot, type StatusTone } from "../Badge/Badge";
import styles from "./SidebarNav.module.css";

export interface SidebarNavProps extends HTMLAttributes<HTMLElement> {
  /** Full-height flush variant with right border (used in app shells). */
  framed?: boolean;
  collapsed?: boolean;
}

export function SidebarNav({
  children,
  className,
  framed,
  collapsed,
  ...rest
}: SidebarNavProps) {
  const classes = [
    styles.sidebar,
    framed ? styles.framed : "",
    collapsed ? styles.collapsed : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <nav className={classes} {...rest}>
      {children}
    </nav>
  );
}

export interface SidebarItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  leading?: ReactNode;
  count?: ReactNode;
}

export function SidebarItem({
  active,
  leading,
  count,
  children,
  className,
  type = "button",
  ...rest
}: SidebarItemProps) {
  const classes = [styles.item, active ? styles.active : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <button type={type} className={classes} {...rest}>
      {leading}
      <span className={styles.itemLabel}>{children}</span>
      {count != null && <span className={styles.count}>{count}</span>}
    </button>
  );
}

export interface SidebarSectionProps extends HTMLAttributes<HTMLDivElement> {
  count?: ReactNode;
}

export function SidebarSection({
  count,
  children,
  className,
  ...rest
}: SidebarSectionProps) {
  return (
    <div
      className={[styles.section, className].filter(Boolean).join(" ")}
      {...rest}
    >
      <span>{children}</span>
      {count != null && <span className={styles.sectionCount}>{count}</span>}
    </div>
  );
}

/* ─── Framed-variant subparts ─────────────────────────────────────────── */

export interface SidebarHeaderProps extends HTMLAttributes<HTMLDivElement> {
  brand?: ReactNode;
  actions?: ReactNode;
}

export function SidebarHeader({
  brand,
  actions,
  className,
  ...rest
}: SidebarHeaderProps) {
  return (
    <div
      className={[styles.header, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {brand && <div className={styles.brand}>{brand}</div>}
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}

export function SidebarHeaderAction({
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={[styles.headerAction, className].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}

/** Top-level nav cluster (Home / Review queue / Activity). */
export function SidebarNavGroup({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={[styles.navGroup, className].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}

/** Scroll region housing workspaces + recent sections. */
export function SidebarScroll({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={[styles.scroll, className].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}

export interface SidebarRepoGroupProps extends HTMLAttributes<HTMLDivElement> {
  name: string;
  color?: string;
  count?: ReactNode;
  expanded?: boolean;
  dim?: boolean;
  /** Highlights the header to indicate the repo home is the active view. */
  active?: boolean;
  leading?: ReactNode;
  /** Trailing hover-revealed action buttons (e.g. new workspace, settings, close). */
  actions?: ReactNode;
  /** Inline content rendered after the repo name (e.g. diff stats, ahead badge). */
  meta?: ReactNode;
  /** Content rendered between meta and actions, always visible (e.g. status badge, agent dot). */
  endContent?: ReactNode;
  /** Secondary line beneath the name, indented to align with it (e.g. branch name). */
  subtitle?: ReactNode;
  /** Always-visible persistent action button rendered after the hover actions (e.g. overflow menu). */
  persistentAction?: ReactNode;
  /** Content rendered inside the group, above the children list (e.g. branch switcher). */
  headerFooter?: ReactNode;
  title?: string;
  onHeaderClick?: () => void;
  onHeaderContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleExpanded?: () => void;
}

export function SidebarRepoGroup({
  name,
  color,
  count,
  expanded = true,
  dim,
  active,
  leading,
  actions,
  meta,
  endContent,
  subtitle,
  persistentAction,
  headerFooter,
  title,
  onHeaderClick,
  onHeaderContextMenu,
  onToggleExpanded,
  children,
  className,
  ...rest
}: SidebarRepoGroupProps) {
  const toggle = onToggleExpanded ?? onHeaderClick;
  const label = onHeaderClick ?? toggle;

  return (
    <div
      className={[styles.repoGroup, className].filter(Boolean).join(" ")}
      {...rest}
    >
      <div
        className={[styles.repoHead, active ? styles.repoHeadActive : ""]
          .filter(Boolean)
          .join(" ")}
        title={title}
      >
        <div className={styles.repoHeadRow}>
          <button
            type="button"
            aria-label={expanded ? "Collapse" : "Expand"}
            className={[
              styles.repoChevron,
              expanded ? "" : styles.repoChevronCollapsed,
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={toggle}
          >
            <ChevronDownIcon size={10} />
          </button>
          <button
            type="button"
            className={styles.repoLabel}
            onClick={label}
            onContextMenu={onHeaderContextMenu}
          >
            {leading && (
              <span
                className={styles.repoLeading}
                style={{ color, opacity: dim ? 0.6 : undefined }}
              >
                {leading}
              </span>
            )}
            <span
              className={styles.repoName}
              style={{ opacity: dim ? 0.75 : undefined }}
            >
              {name}
            </span>
            {count != null && <span className={styles.repoCount}>{count}</span>}
          </button>
          {endContent && (
            <div className={styles.repoEndContent}>{endContent}</div>
          )}
          {actions && <div className={styles.repoActions}>{actions}</div>}
        </div>
        {(subtitle || meta || persistentAction) && (
          <div className={styles.repoSubtitleRow}>
            <span className={styles.repoSubtitle}>{subtitle}</span>
            <span className={styles.repoSubtitleTrailing}>
              {meta && <span className={styles.repoMeta}>{meta}</span>}
              {persistentAction && (
                <span className={styles.repoPersistentAction}>
                  {persistentAction}
                </span>
              )}
            </span>
          </div>
        )}
      </div>
      {expanded && (headerFooter || children) && (
        <div className={styles.workspaceList}>
          {headerFooter}
          {children}
        </div>
      )}
    </div>
  );
}

export interface SidebarRepoActionProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  title: string;
}

export function SidebarRepoAction({
  title,
  children,
  className,
  type = "button",
  ...rest
}: SidebarRepoActionProps) {
  return (
    <button
      type={type}
      title={title}
      aria-label={title}
      className={[styles.repoActionBtn, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface SidebarWorkspaceRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  name: string;
  status?: StatusTone;
  pulse?: boolean;
  active?: boolean;
  added?: number;
  removed?: number;
  meta?: ReactNode;
}

export function SidebarWorkspaceRow({
  name,
  status = "success",
  pulse,
  active,
  added,
  removed,
  meta,
  className,
  type = "button",
  ...rest
}: SidebarWorkspaceRowProps) {
  const classes = [
    styles.workspaceRow,
    active ? styles.workspaceRowActive : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type={type} className={classes} {...rest}>
      <span className={styles.workspaceNameRow}>
        <StatusDot tone={status} pulse={pulse} />
        <span className={styles.workspaceName}>{name}</span>
        {(added != null || removed != null) && (
          <span className={styles.workspaceDiff}>
            {added != null && <span className={styles.diffAdd}>+{added}</span>}
            {removed != null && (
              <span className={styles.diffDel}>−{removed}</span>
            )}
          </span>
        )}
      </span>
      {meta && <span className={styles.workspaceMeta}>{meta}</span>}
    </button>
  );
}

export interface SidebarFooterProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  leading?: ReactNode;
  as?: "button" | "div";
}

export function SidebarFooter({
  leading,
  children,
  className,
  type = "button",
  as = "button",
  ...rest
}: SidebarFooterProps) {
  const classes = [styles.footer, className].filter(Boolean).join(" ");
  if (as === "div") {
    return (
      <div className={classes}>
        {leading}
        {children}
      </div>
    );
  }

  return (
    <button type={type} className={classes} {...rest}>
      {leading}
      {children}
    </button>
  );
}
