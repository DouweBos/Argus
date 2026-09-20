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
}: RunHistoryRowProps) {
  return (
    <div
      className={[styles.row, selected ? styles.selected : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <button type="button" className={styles.main} onClick={onClick}>
        <span className={styles.top}>
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
