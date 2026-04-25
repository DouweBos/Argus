import { useState } from "react";
import * as Icons from "../../icons/Icons";
import styles from "./LogEntry.module.css";

export type LogLevel =
  | "debug"
  | "error"
  | "info"
  | "log"
  | "verbose"
  | "warning";

export type LogSource = "console" | "device" | "metro";

export interface LogEntryProps {
  timestamp: string;
  level: LogLevel;
  message: string;
  stackTrace?: string | null;
  source?: LogSource | null;
  /** When true, the stack trace starts expanded. Defaults to false. */
  defaultExpanded?: boolean;
}

const LEVEL_LABEL: Record<LogLevel, string> = {
  verbose: "VRB",
  debug: "DBG",
  log: "LOG",
  info: "INF",
  warning: "WRN",
  error: "ERR",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return iso;
  }
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");

  return `${hh}:${mm}:${ss}.${ms}`;
}

export function LogEntry({
  timestamp,
  level,
  message,
  stackTrace,
  source,
  defaultExpanded = false,
}: LogEntryProps) {
  const hasStack = !!stackTrace && stackTrace.trim().length > 0;
  const [expanded, setExpanded] = useState(defaultExpanded);

  const time = formatTime(timestamp);

  let toggleIcon = null;
  if (hasStack) {
    toggleIcon = expanded ? (
      <Icons.ChevronDownIcon size={10} />
    ) : (
      <Icons.ChevronRightIcon size={10} />
    );
  }

  return (
    <div className={`${styles.row} ${styles[`level_${level}`]}`}>
      <div className={styles.gutter} aria-hidden />
      <button
        type="button"
        className={styles.head}
        onClick={() => hasStack && setExpanded((v) => !v)}
        disabled={!hasStack}
        aria-expanded={hasStack ? expanded : undefined}
      >
        <span className={styles.toggle} aria-hidden>
          {toggleIcon}
        </span>
        <span className={styles.time}>{time}</span>
        <span className={`${styles.level} ${styles[`badge_${level}`]}`}>
          {LEVEL_LABEL[level]}
        </span>
        {source ? <span className={styles.source}>{source}</span> : null}
        <span className={styles.message}>{message}</span>
      </button>
      {hasStack && expanded ? (
        <pre className={styles.stack}>{stackTrace}</pre>
      ) : null}
    </div>
  );
}
