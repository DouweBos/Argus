import type { ReactNode } from "react";
import styles from "./ReportRefList.module.css";

/** A live entity a report points at, resolved from current state by id. */
export interface ReportRef {
  id: string;
  /** Status badge, confidence chip — whatever the host wants trailing. */
  meta?: ReactNode;
  onOpen?: () => void;
  subtitle?: string;
  title: string;
}

export interface ReportRefListProps {
  ids: string[];
  /** What the ids name, for the line shown when one no longer resolves. */
  kind: "proposal" | "session";
  /**
   * Resolves an id against current state. Returning null renders a tombstone
   * instead of a stale snapshot — a report must never claim something exists.
   */
  resolve?: (id: string) => ReportRef | null;
}

/** The `proposals` / `sessions` blocks — cards rendered from live state. */
export function ReportRefList({ ids, kind, resolve }: ReportRefListProps) {
  return (
    <div className={styles.list}>
      {ids.map((id) => {
        const ref = resolve?.(id) ?? null;
        if (!ref) {
          return (
            <p className={styles.missing} key={id}>
              {`This ${kind} is no longer available.`}
            </p>
          );
        }

        return (
          <div
            className={[styles.card, ref.onOpen ? styles.clickable : ""]
              .filter(Boolean)
              .join(" ")}
            key={id}
            onClick={ref.onOpen}
            onKeyDown={(e) => {
              if (ref.onOpen && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                ref.onOpen();
              }
            }}
            role={ref.onOpen ? "button" : undefined}
            tabIndex={ref.onOpen ? 0 : undefined}
          >
            <div className={styles.body}>
              <span className={styles.title}>{ref.title}</span>
              {ref.subtitle && (
                <span className={styles.subtitle}>{ref.subtitle}</span>
              )}
            </div>
            {ref.meta && <div className={styles.meta}>{ref.meta}</div>}
          </div>
        );
      })}
    </div>
  );
}
