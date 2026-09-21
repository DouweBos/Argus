import { Fragment } from "react";
import styles from "./Breadcrumbs.module.css";

export interface Crumb {
  id: string;
  label: string;
  /** Omitted on the last crumb, and on any ancestor that isn't navigable. */
  onClick?: () => void;
}

export interface BreadcrumbsProps {
  items: Crumb[];
  className?: string;
}

/** The trail to the current screen. The last crumb is where you are. */
export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={[styles.trail, className].filter(Boolean).join(" ")}
    >
      {items.map((crumb, i) => {
        const last = i === items.length - 1;

        return (
          <Fragment key={crumb.id}>
            {i > 0 && (
              <span aria-hidden className={styles.separator}>
                ·
              </span>
            )}
            {crumb.onClick && !last ? (
              <button
                type="button"
                className={styles.link}
                onClick={crumb.onClick}
              >
                {crumb.label}
              </button>
            ) : (
              <span
                className={last ? styles.current : styles.crumb}
                aria-current={last ? "page" : undefined}
              >
                {crumb.label}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
