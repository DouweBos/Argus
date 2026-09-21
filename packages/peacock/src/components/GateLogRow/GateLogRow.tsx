import type { ReactNode } from "react";
import { Badge } from "../Badge/Badge";
import { Button } from "../Button/Button";
import styles from "./GateLogRow.module.css";

export interface GateLogRowProps {
  /** The automation whose run was refused. */
  automationName: ReactNode;
  /** What it tried — a command line, or a tool name. */
  attempted: ReactNode;
  /** The allowlist entry that would permit it. */
  suggestedEntry: string;
  /** How many times this same refusal has happened. */
  count: number;
  /** When it last happened, already formatted. */
  lastSeen: ReactNode;
  onAllow: () => void;
  onDismiss: () => void;
}

/**
 * One thing the read-only gate turned away, with the two answers available:
 * allow it from now on, or decide it should stay refused.
 */
export function GateLogRow({
  automationName,
  attempted,
  suggestedEntry,
  count,
  lastSeen,
  onAllow,
  onDismiss,
}: GateLogRowProps) {
  return (
    <div className={styles.row}>
      <div className={styles.main}>
        <span className={styles.top}>
          <span className={styles.name}>{automationName}</span>
          {count > 1 && <Badge tone="neutral">{count}×</Badge>}
          <span className={styles.seen}>{lastSeen}</span>
        </span>
        <code className={styles.attempted}>{attempted}</code>
      </div>
      <div className={styles.actions}>
        <Button
          size="sm"
          variant="secondary"
          title={`Allow "${suggestedEntry}" from now on`}
          onClick={onAllow}
        >
          Allow {suggestedEntry}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
