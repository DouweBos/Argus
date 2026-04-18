import type { HTMLAttributes, ReactNode } from "react";
import styles from "./EmptyState.module.css";

export interface EmptyStateProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "title"
> {
  /** Short primary message, e.g. "No agent running". */
  title: ReactNode;
  /** Optional supporting sentence. */
  body?: ReactNode;
  /** Optional CTA slot — pass a `<Button>` or similar. */
  action?: ReactNode;
  /** Small icon or decorative node rendered above the title. */
  icon?: ReactNode;
}

/**
 * Panel-level empty state. Compact, centered, no full-screen glow.
 * Use `EmptyHome` for the full-screen app launch state instead.
 */
export function EmptyState({
  title,
  body,
  action,
  icon,
  className,
  ...rest
}: EmptyStateProps) {
  return (
    <div
      className={[styles.wrap, className].filter(Boolean).join(" ")}
      {...rest}
    >
      {icon && <div className={styles.icon}>{icon}</div>}
      <p className={styles.title}>{title}</p>
      {body && <p className={styles.body}>{body}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
