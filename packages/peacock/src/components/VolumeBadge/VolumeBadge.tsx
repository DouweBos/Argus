import type { HTMLAttributes } from "react";
import { DriveIcon } from "../../icons/Icons";
import { StatusBulb } from "../StatusBulb/StatusBulb";
import styles from "./VolumeBadge.module.css";

export type VolumeBadgeState = "available" | "unavailable";

export interface VolumeBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Drive name, e.g. "Blackbox". */
  label: string;
  state?: VolumeBadgeState;
}

/**
 * Which drive a project's worktrees are kept on.
 *
 * Only worth showing once they are somewhere other than the internal disk —
 * at which point the drive being absent is the explanation for a whole list
 * of sessions that cannot be opened.
 */
export function VolumeBadge({
  label,
  state = "available",
  className,
  ...rest
}: VolumeBadgeProps) {
  return (
    <span
      className={[styles.badge, styles[state], className]
        .filter(Boolean)
        .join(" ")}
      title={
        state === "available"
          ? `Worktrees are stored on ${label}`
          : `${label} isn't connected — showing the last known state`
      }
      {...rest}
    >
      <DriveIcon size={9} />
      <span className={styles.label}>{label}</span>
      {state === "unavailable" && <StatusBulb size="sm" tone="error" />}
    </span>
  );
}
