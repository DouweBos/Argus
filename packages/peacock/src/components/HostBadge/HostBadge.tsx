import type { HTMLAttributes } from "react";
import { HostIcon } from "../../icons/Icons";
import { StatusBulb, type StatusBulbTone } from "../StatusBulb/StatusBulb";
import styles from "./HostBadge.module.css";

export type HostBadgeState = "connected" | "offline" | "reconnecting";

export interface HostBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  label: string;
  state?: HostBadgeState;
}

const TONE: Record<HostBadgeState, StatusBulbTone> = {
  connected: "success",
  reconnecting: "warning",
  offline: "error",
};

const TITLE: Record<HostBadgeState, string> = {
  connected: "connected",
  reconnecting: "reconnecting",
  offline: "disconnected — showing the last snapshot",
};

/**
 * Which machine a project, session or device lives on. Two hosts can hold a
 * repo at the same path, so the list says so rather than leaving the user to
 * guess which one they are about to start an agent on.
 */
export function HostBadge({
  label,
  state = "connected",
  className,
  ...rest
}: HostBadgeProps) {
  return (
    <span
      className={[styles.badge, styles[state], className]
        .filter(Boolean)
        .join(" ")}
      title={`${label} — ${TITLE[state]}`}
      {...rest}
    >
      <HostIcon size={9} />
      <span className={styles.label}>{label}</span>
      {state !== "connected" && <StatusBulb size="sm" tone={TONE[state]} />}
    </span>
  );
}
