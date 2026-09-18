import type { ReactNode } from "react";
import styles from "./InboxItemRow.module.css";

export interface InboxItemRowProps {
  /** Right-aligned buttons. Stops click-through to `onOpen`. */
  actions?: ReactNode;
  leading?: ReactNode;
  /** Status badge, commit count — anything short and trailing. */
  meta?: ReactNode;
  onOpen?: () => void;
  subtitle?: ReactNode;
  title: ReactNode;
  /** Colours the left edge: `alert` for things that went wrong. */
  tone?: "alert" | "neutral";
}

/** A non-decision line in the inbox: work in flight, or a run that failed. */
export function InboxItemRow({
  actions,
  leading,
  meta,
  onOpen,
  subtitle,
  title,
  tone = "neutral",
}: InboxItemRowProps) {
  return (
    <div
      className={[styles.row, tone === "alert" ? styles.alert : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <button className={styles.main} onClick={onOpen} type="button">
        {leading && <span className={styles.leading}>{leading}</span>}
        <span className={styles.text}>
          <span className={styles.title}>{title}</span>
          {subtitle != null && (
            <span className={styles.subtitle}>{subtitle}</span>
          )}
        </span>
      </button>
      {meta != null && <div className={styles.meta}>{meta}</div>}
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
