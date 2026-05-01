import type { HTMLAttributes } from "react";
import styles from "./RefBadge.module.css";

export type RefType =
  | "head"
  | "local-branch"
  | "remote-branch"
  | "stash"
  | "tag";

export interface RefBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** HEAD pointing at this ref — gets the emphasised treatment. */
  current?: boolean;
  name: string;
  size?: "md" | "sm";
  type: RefType;
}

const ICONS: Record<RefType, string | null> = {
  "local-branch": "⎇",
  "remote-branch": "↗",
  tag: "⚑",
  head: null,
  stash: "⌸",
};

const LABELS: Record<RefType, string> = {
  "local-branch": "Local branch",
  "remote-branch": "Remote branch",
  tag: "Tag",
  head: "HEAD",
  stash: "Stash",
};

export function RefBadge({
  name,
  type,
  current,
  size = "md",
  className,
  ...rest
}: RefBadgeProps) {
  const classes = [
    styles.badge,
    styles[`type-${type}`],
    size === "sm" ? styles.sm : "",
    current ? styles.current : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} title={`${LABELS[type]}: ${name}`} {...rest}>
      {ICONS[type] && (
        <span aria-hidden className={styles.icon}>
          {ICONS[type]}
        </span>
      )}
      <span className={styles.name}>{name}</span>
    </span>
  );
}
