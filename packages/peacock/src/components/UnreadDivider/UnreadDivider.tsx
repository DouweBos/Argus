import type { HTMLAttributes } from "react";
import styles from "./UnreadDivider.module.css";

export interface UnreadDividerProps extends HTMLAttributes<HTMLDivElement> {
  label?: string;
}

export function UnreadDivider({
  label = "Unread",
  className,
  ...rest
}: UnreadDividerProps) {
  return (
    <div
      role="separator"
      aria-label={label}
      className={[styles.divider, className].filter(Boolean).join(" ")}
      {...rest}
    >
      <span className={styles.label}>{label}</span>
      <span className={styles.line} />
    </div>
  );
}
