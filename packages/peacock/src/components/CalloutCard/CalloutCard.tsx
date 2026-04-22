import type { HTMLAttributes, ReactNode } from "react";
import styles from "./CalloutCard.module.css";

export type CalloutTone =
  | "accent"
  | "error"
  | "neutral"
  | "success"
  | "warning";

export interface CalloutCardProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "title"
> {
  tone?: CalloutTone;
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}

const toneClass: Record<CalloutTone, string> = {
  neutral: styles.neutral,
  accent: styles.accent,
  success: styles.success,
  warning: styles.warning,
  error: styles.error,
};

export function CalloutCard({
  tone = "neutral",
  leading,
  title,
  meta,
  actions,
  className,
  ...rest
}: CalloutCardProps) {
  const classes = [styles.card, toneClass[tone], className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} {...rest}>
      {leading && <span className={styles.leading}>{leading}</span>}
      <div className={styles.body}>
        <div className={styles.title}>{title}</div>
        {meta && <div className={styles.meta}>{meta}</div>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
