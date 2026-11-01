import type { ReactNode } from "react";
import { ChevronRightIcon } from "../../icons/Icons";
import styles from "./WorkLogRow.module.css";

export interface WorkLogRowProps {
  /** "Worked for 5m 29s", "Working for 12s · 1 agent still running". */
  label: string;
  /** Read out after the label, e.g. "3 tool calls". */
  detail?: string;
  /** Whether the work is drawn open below the summary. */
  open: boolean;
  /** Locks it open, e.g. while a decision inside waits on you. */
  locked?: boolean;
  /** The agent is still on this turn: the label counts up. */
  working?: boolean;
  onToggle: () => void;
  /** The turn's messages, drawn while open. */
  children?: ReactNode;
  className?: string;
}

/** A turn's work folded into one quiet line that opens in place. */
export function WorkLogRow({
  label,
  detail,
  open,
  locked = false,
  working = false,
  onToggle,
  children,
  className,
}: WorkLogRowProps) {
  return (
    <div className={[styles.row, className].filter(Boolean).join(" ")}>
      <button
        aria-expanded={open}
        aria-label={detail ? `${label}, ${detail}` : label}
        className={styles.summary}
        disabled={locked}
        title={detail}
        type="button"
        onClick={onToggle}
      >
        <span className={working ? styles.working : undefined}>{label}</span>
        <ChevronRightIcon
          className={[styles.chevron, open ? styles.chevronOpen : ""]
            .filter(Boolean)
            .join(" ")}
          size={9}
        />
      </button>
      {open && <div className={styles.body}>{children}</div>}
      <div className={styles.rule} />
    </div>
  );
}
