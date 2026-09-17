import type { ReactNode } from "react";
import { Toggle } from "../Toggle/Toggle";
import styles from "./AutomationRow.module.css";

export interface AutomationRowProps {
  /** Hover-revealed and always-visible actions (run, open, …). */
  actions?: ReactNode;
  description?: ReactNode;
  enabled: boolean;
  /** Disables the switch, e.g. while the toggle is in flight. */
  enableDisabled?: boolean;
  /** Status of the most recent run, as a badge. */
  lastRunStatus?: ReactNode;
  lastRunLabel: ReactNode;
  name: ReactNode;
  nextRunLabel: ReactNode;
  onOpen?: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  selected?: boolean;
  /** Trigger summary — a cron expression, or "Manual only". */
  trigger: ReactNode;
}

/**
 * One automation in the list: what it is, when it last fired, when it fires
 * next, and the switch that decides whether it fires at all.
 */
export function AutomationRow({
  actions,
  description,
  enabled,
  enableDisabled,
  lastRunLabel,
  lastRunStatus,
  name,
  nextRunLabel,
  onOpen,
  onToggleEnabled,
  selected,
  trigger,
}: AutomationRowProps) {
  return (
    <div
      className={[styles.row, selected ? styles.selected : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <Toggle
        checked={enabled}
        disabled={enableDisabled}
        onChange={onToggleEnabled}
        size="sm"
      />
      <button type="button" className={styles.main} onClick={onOpen}>
        <span className={styles.titleLine}>
          <span className={styles.name}>{name}</span>
          <span className={styles.trigger}>{trigger}</span>
        </span>
        {description != null && (
          <span className={styles.description}>{description}</span>
        )}
      </button>
      <div className={styles.meta}>
        <span className={styles.metaLabel}>Last run</span>
        <span className={styles.metaValue}>
          {lastRunStatus}
          {lastRunLabel}
        </span>
      </div>
      <div className={styles.meta}>
        <span className={styles.metaLabel}>Next run</span>
        <span className={styles.metaValue}>{nextRunLabel}</span>
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
