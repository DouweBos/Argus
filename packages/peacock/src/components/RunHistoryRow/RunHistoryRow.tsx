import type { ReactNode } from "react";
import styles from "./RunHistoryRow.module.css";

export interface RunHistoryRowProps {
  /** Trailing actions, e.g. cancel while the run is in flight. */
  actions?: ReactNode;
  cost: ReactNode;
  duration: ReactNode;
  /** Failure or skip reason, shown beneath the row. */
  error?: ReactNode;
  /** Which automation the run belongs to. Only needed across automations. */
  name?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  startedAt: ReactNode;
  /** Status badge for the run. */
  status: ReactNode;
  /** Why the run fired — "manual", "schedule 07:30", "catch-up". */
  triggerReason: ReactNode;
  /** Report nobody has read yet — the row is emphasized and dotted. */
  unread?: boolean;
  /** "card" gives the row its own surface — for lists that float on a page. */
  variant?: "card" | "plain";
}

/** One firing of an automation, as a row in its history. */
export function RunHistoryRow({
  actions,
  cost,
  duration,
  error,
  name,
  onClick,
  selected,
  startedAt,
  status,
  triggerReason,
  unread,
  variant = "plain",
}: RunHistoryRowProps) {
  return (
    <div
      className={[
        styles.row,
        variant === "card" ? styles.card : "",
        selected ? styles.selected : "",
        unread ? styles.unread : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button type="button" className={styles.main} onClick={onClick}>
        <span className={styles.top}>
          {unread && <span className={styles.dot} aria-label="Unread report" />}
          {status}
          {name != null && <span className={styles.name}>{name}</span>}
          <span className={styles.started}>{startedAt}</span>
          <span className={styles.reason}>{triggerReason}</span>
          <span className={styles.spacer} />
          <span className={styles.figure}>{duration}</span>
          <span className={styles.figure}>{cost}</span>
        </span>
        {error != null && <span className={styles.error}>{error}</span>}
      </button>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
