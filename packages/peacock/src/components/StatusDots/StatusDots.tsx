import type { HTMLAttributes } from "react";
import styles from "./StatusDots.module.css";

export type StatusDotsState = "awaiting" | "idle" | "running";

interface StatusDotsProps extends HTMLAttributes<HTMLSpanElement> {
  state?: StatusDotsState;
}

const STATE_LABEL: Record<StatusDotsState, string> = {
  idle: "Idle",
  running: "Running",
  awaiting: "Awaiting permission",
};

export function StatusDots({
  state = "idle",
  className,
  ...rest
}: StatusDotsProps) {
  return (
    <span
      className={[styles.grid, styles[state], className]
        .filter(Boolean)
        .join(" ")}
      role="status"
      aria-label={STATE_LABEL[state]}
      {...rest}
    >
      {Array.from({ length: 9 }).map((_, i) => (
        <span key={i} className={styles.dot} />
      ))}
    </span>
  );
}
