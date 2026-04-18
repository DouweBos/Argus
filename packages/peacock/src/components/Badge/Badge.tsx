import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Badge.module.css";

export type BadgeTone =
  | "accent"
  | "error"
  | "neutral"
  | "neutralFilled"
  | "success"
  | "warning";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Taller pill used for status banners ("initializing", "error"). */
  size?: "pill" | "tag";
}

export function Badge({
  tone = "accent",
  size = "pill",
  className,
  children,
  ...rest
}: BadgeProps) {
  const classes = [
    styles.badge,
    size === "tag" ? styles.tag : "",
    styles[tone],
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}

export type StatusTone = "accent" | "error" | "idle" | "success" | "warning";

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  label?: ReactNode;
  pulse?: boolean;
}

export function StatusDot({
  tone = "success",
  label,
  pulse,
  className,
  ...rest
}: StatusDotProps) {
  const dotClass = [styles.dotLight, styles[tone], pulse ? styles.pulse : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={[styles.dot, className].filter(Boolean).join(" ")}
      {...rest}
    >
      <span className={dotClass} />
      {label}
    </span>
  );
}
