import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { SearchIcon } from "../../icons/Icons";
import styles from "./AppSidebar.module.css";

export interface AppSidebarProps extends HTMLAttributes<HTMLElement> {
  /** Search and the list's actions, along the top. */
  top?: ReactNode;
  /** The everyday screens, under the search. */
  nav?: ReactNode;
  /** Settings and the occasional screens, along the foot. */
  footer?: ReactNode;
  /** Shown between the list and the foot, e.g. a reconnecting badge. */
  status?: ReactNode;
}

/**
 * Argus for Mac's sidebar: search on top, the everyday screens, then the
 * projects and their sessions scrolling, and a row of icons at the foot.
 * The list itself goes in `children`.
 */
export function AppSidebar({
  top,
  nav,
  footer,
  status,
  children,
  className,
  ...rest
}: AppSidebarProps) {
  return (
    <nav
      className={[styles.sidebar, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {top && <div className={styles.top}>{top}</div>}
      {nav && <div className={styles.nav}>{nav}</div>}
      <div className={styles.list}>{children}</div>
      {status && <div className={styles.status}>{status}</div>}
      {footer && <div className={styles.footer}>{footer}</div>}
    </nav>
  );
}

export interface SidebarSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/** The sidebar's borderless search field. */
export function SidebarSearchField({
  value,
  onChange,
  placeholder = "Search",
}: SidebarSearchFieldProps) {
  return (
    <label className={styles.search}>
      <SearchIcon size={13} />
      <input
        aria-label={placeholder}
        className={styles.searchInput}
        placeholder={placeholder}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onChange("");
          }
        }}
      />
    </label>
  );
}

export interface AppSidebarNavItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  selected?: boolean;
  /** Something waiting there; hidden at 0. */
  count?: number;
}

/** One of the everyday screens: icon, label, a count when something waits. */
export function AppSidebarNavItem({
  icon,
  label,
  selected,
  count,
  className,
  type = "button",
  ...rest
}: AppSidebarNavItemProps) {
  return (
    <button
      aria-current={selected ? "page" : undefined}
      className={[styles.row, styles.navItem, className]
        .filter(Boolean)
        .join(" ")}
      data-selected={selected || undefined}
      type={type}
      {...rest}
    >
      <span className={styles.navIcon}>{icon}</span>
      <span className={styles.navLabel}>{label}</span>
      {count != null && count > 0 && (
        <span className={styles.pill}>{count}</span>
      )}
    </button>
  );
}

/** A project header and its sessions, packed tight. */
export function AppSidebarGroup({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={[styles.group, className].filter(Boolean).join(" ")}
      role="group"
      {...rest}
    />
  );
}

export interface AppSidebarSectionRuleProps {
  label: string;
  /** A trailing control, e.g. a `FlatIconButton` that adds to the section. */
  action?: ReactNode;
}

/** A quiet section label with a hairline running to its action ("Scratch pads ——— +"). */
export function AppSidebarSectionRule({
  label,
  action,
}: AppSidebarSectionRuleProps) {
  return (
    <div className={styles.rule}>
      <span className={styles.ruleLabel}>{label}</span>
      <span className={styles.ruleLine} />
      {action}
    </div>
  );
}

/** The foot's icons: settings and the occasional screens, then the bell on the far side. */
export function AppSidebarFooter({
  leading,
  trailing,
}: {
  leading: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <>
      <div className={styles.footerGroup}>{leading}</div>
      <div className={styles.footerGroup}>{trailing}</div>
    </>
  );
}
