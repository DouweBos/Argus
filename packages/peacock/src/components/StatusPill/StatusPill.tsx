import type { HTMLAttributes } from "react";
import styles from "./StatusPill.module.css";

export type StatusPillTone = "fail" | "pass" | "running" | "skipped" | "warn";

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  tone: StatusPillTone;
}

const LABELS: Record<StatusPillTone, string> = {
  pass: "OK",
  warn: "Warning",
  fail: "Missing",
  skipped: "Skipped",
  running: "Checking…",
};

export function StatusPill({
  tone,
  className,
  children,
  ...rest
}: StatusPillProps) {
  return (
    <span
      className={[styles.pill, styles[tone], className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children ?? LABELS[tone]}
    </span>
  );
}
