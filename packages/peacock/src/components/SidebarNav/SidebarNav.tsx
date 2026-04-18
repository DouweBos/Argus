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
  leading?: ReactNode;
  onHeaderClick?: () => void;
}

export function SidebarRepoGroup({
  name,
  color,
  count,
  expanded = true,
  dim,
  leading,
  onHeaderClick,
  children,
  className,
  ...rest
}: SidebarRepoGroupProps) {
  return (
    <div
      className={[styles.repoGroup, className].filter(Boolean).join(" ")}
      {...rest}
    >
      <button type="button" className={styles.repoHead} onClick={onHeaderClick}>
        <span
          className={[
            styles.repoChevron,
            expanded ? "" : styles.repoChevronCollapsed,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <ChevronDownIcon size={10} />
        </span>
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
      {expanded && children && (
        <div className={styles.workspaceList}>{children}</div>
      )}
    </div>
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
