import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import styles from "./SidebarNav.module.css";

export function SidebarNav({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLElement>) {
  return (
    <nav
      className={[styles.sidebar, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </nav>
  );
}

export interface SidebarItemProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
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
  const classes = [
    styles.item,
    active ? styles.active : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={classes} {...rest}>
      {leading}
      {children}
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
