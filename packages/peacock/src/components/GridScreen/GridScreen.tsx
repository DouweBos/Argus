import type { HTMLAttributes, ReactNode } from "react";
import styles from "./GridScreen.module.css";

export interface GridScreenProps extends HTMLAttributes<HTMLDivElement> {
  /** When true, removes the outer padding (useful for embedded screens). */
  plain?: boolean;
}

/**
 * Screen shell for list-style views (Projects, Pull requests, etc).
 *
 * Compose with `GridScreen.Header`, `GridScreen.Section`, and
 * `GridScreen.Grid` to get consistent headings, grouped sections, and a
 * responsive 1 → 2 column grid on wider displays.
 */
export function GridScreen({
  plain,
  className,
  children,
  ...rest
}: GridScreenProps) {
  const classes = [styles.screen, plain ? styles.plain : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}

export interface GridScreenHeaderProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "title"
> {
  actions?: ReactNode;
  subtitle?: ReactNode;
  title: ReactNode;
}

function GridScreenHeader({
  title,
  subtitle,
  actions,
  className,
  ...rest
}: GridScreenHeaderProps) {
  const classes = [styles.head, className ?? ""].filter(Boolean).join(" ");

  return (
    <header className={classes} {...rest}>
      <div className={styles.headText}>
        <span className={styles.title}>{title}</span>
        {subtitle !== undefined && subtitle !== null && (
          <span className={styles.sub}>{subtitle}</span>
        )}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}

export interface GridScreenSectionProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "title"
> {
  actions?: ReactNode;
  count?: ReactNode;
  title: ReactNode;
}

function GridScreenSection({
  title,
  count,
  actions,
  className,
  children,
  ...rest
}: GridScreenSectionProps) {
  const classes = [styles.section, className ?? ""].filter(Boolean).join(" ");

  return (
    <section className={classes} {...rest}>
      <h3 className={styles.sectionHead}>
        <span className={styles.sectionTitle}>{title}</span>
        {count !== undefined && count !== null && (
          <span className={styles.sectionCount}>{count}</span>
        )}
        {actions && <span className={styles.sectionActions}>{actions}</span>}
      </h3>
      {children}
    </section>
  );
}

export interface GridScreenGridProps extends HTMLAttributes<HTMLDivElement> {
  /** Max columns on wide screens. Defaults to 2. */
  columns?: 2 | 3;
}

function GridScreenGrid({
  columns = 2,
  className,
  children,
  ...rest
}: GridScreenGridProps) {
  const classes = [
    styles.grid,
    columns === 3 ? styles.cols3 : styles.cols2,
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}

GridScreen.Header = GridScreenHeader;
GridScreen.Section = GridScreenSection;
GridScreen.Grid = GridScreenGrid;

export { GridScreenGrid, GridScreenHeader, GridScreenSection };
