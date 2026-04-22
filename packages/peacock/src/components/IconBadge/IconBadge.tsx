import type { HTMLAttributes, ReactNode } from "react";
import styles from "./IconBadge.module.css";

export type IconBadgeSize = "lg" | "md" | "sm";
export type IconBadgeTone =
  | "accent"
  | "error"
  | "neutral"
  | "project"
  | "success"
  | "warning";

export interface IconBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  size?: IconBadgeSize;
  tone?: IconBadgeTone;
  children: ReactNode;
}

const toneClass: Record<IconBadgeTone, string> = {
  neutral: styles.neutral,
  accent: styles.accent,
  success: styles.success,
  warning: styles.warning,
  error: styles.error,
  project: styles.project,
};

const sizeClass: Record<IconBadgeSize, string> = {
  sm: styles.sm,
  md: styles.md,
  lg: styles.lg,
};

export function IconBadge({
  size = "md",
  tone = "neutral",
  className,
  children,
  ...rest
}: IconBadgeProps) {
  const classes = [styles.badge, sizeClass[size], toneClass[tone], className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}
