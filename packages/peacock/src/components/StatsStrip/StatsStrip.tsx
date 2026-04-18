import type { HTMLAttributes, ReactNode } from "react";
import { StatusDot } from "../Badge/Badge";
import styles from "./StatsStrip.module.css";

export function StatsStrip({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={[styles.strip, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
}

export type DeltaTone = "negative" | "neutral" | "positive";

export interface StatCellProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  value: ReactNode;
  delta?: ReactNode;
  deltaTone?: DeltaTone;
  /** When true, colors the value accent and shows a pulsing live dot. */
  live?: boolean;
}

export function StatCell({
  label,
  value,
  delta,
  deltaTone = "neutral",
  live,
  className,
  ...rest
}: StatCellProps) {
  const classes = [styles.cell, live ? styles.live : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  const deltaClass = [
    styles.delta,
    deltaTone === "positive" ? styles.deltaPositive : "",
    deltaTone === "negative" ? styles.deltaNegative : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} {...rest}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{value}</div>
      {delta != null && <div className={deltaClass}>{delta}</div>}
      {live && (
        <span className={styles.liveDot}>
          <StatusDot tone="success" pulse />
        </span>
      )}
    </div>
  );
}
