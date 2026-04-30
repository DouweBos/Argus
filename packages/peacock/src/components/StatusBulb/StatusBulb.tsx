import type { HTMLAttributes } from "react";
import styles from "./StatusBulb.module.css";

export type StatusBulbTone =
  | "error"
  | "neutral"
  | "pending"
  | "success"
  | "warning";

export type StatusBulbSize = "lg" | "md" | "sm";

export interface StatusBulbProps extends HTMLAttributes<HTMLSpanElement> {
  /** Slow pulse animation, useful for "checking…" states. */
  pulse?: boolean;
  size?: StatusBulbSize;
  tone: StatusBulbTone;
}

/**
 * A single colored dot used as an at-a-glance status indicator (think
 * traffic-light bulb). Pair with a label for accessibility.
 */
export function StatusBulb({
  tone,
  size = "md",
  pulse = false,
  className,
  ...rest
}: StatusBulbProps) {
  return (
    <span
      className={[
        styles.bulb,
        styles[tone],
        styles[size],
        pulse ? styles.pulse : null,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    />
  );
}
