import type { ReactNode } from "react";
import { CheckIcon, HostIcon, LaptopIcon } from "../../icons/Icons";
import { Button } from "../Button/Button";
import { StatusBulb, type StatusBulbTone } from "../StatusBulb/StatusBulb";
import styles from "./HostConnectionList.module.css";

/** How a host's link is doing, from the client's side. */
export type HostLinkState =
  | "connected"
  | "connecting"
  | "detached"
  | "failed"
  | "reconnecting";

export interface HostConnectionEntry {
  /** True while this host's sockets are live. */
  attached: boolean;
  /** Secondary line — the gateway address, or why it failed. */
  detail?: string;
  /** True when the current view reads from this host. */
  focused: boolean;
  id: string;
  label: string;
  /** This Mac. Always attached; cannot be detached. */
  local?: boolean;
  state: HostLinkState;
}

export interface HostConnectionListProps {
  /** Host with an attach/detach in flight — its buttons go quiet. */
  busyId?: string | null;
  /** Rendered under the list (e.g. "Pair a host…"). */
  footer?: ReactNode;
  hosts: HostConnectionEntry[];
  onAttach: (id: string) => void;
  onDetach: (id: string) => void;
  onFocus: (id: string) => void;
}

const STATE_TONE: Record<HostLinkState, StatusBulbTone> = {
  connected: "success",
  connecting: "pending",
  reconnecting: "warning",
  failed: "error",
  detached: "neutral",
};

const STATE_LABEL: Record<HostLinkState, string> = {
  connected: "Connected",
  connecting: "Connecting…",
  reconnecting: "Reconnecting…",
  failed: "Unreachable",
  detached: "Not attached",
};

/**
 * Every machine this window can drive, attached or not. Several are live at
 * once, so each row carries its own connection state and its own attach /
 * detach — one host going away says nothing about the others.
 */
export function HostConnectionList({
  hosts,
  busyId,
  footer,
  onAttach,
  onDetach,
  onFocus,
}: HostConnectionListProps) {
  return (
    <div className={styles.list} role="list">
      {hosts.map((host) => (
        <div key={host.id} className={styles.row} role="listitem">
          <button
            aria-current={host.focused}
            className={styles.pick}
            disabled={!host.attached}
            type="button"
            onClick={() => onFocus(host.id)}
          >
            <span className={styles.icon}>
              {host.local ? <LaptopIcon size={13} /> : <HostIcon size={13} />}
            </span>
            <span className={styles.text}>
              <span className={styles.label}>{host.label}</span>
              <span className={styles.detail}>
                {host.detail ?? STATE_LABEL[host.state]}
              </span>
            </span>
            <span className={styles.status}>
              <StatusBulb
                pulse={
                  host.state === "connecting" || host.state === "reconnecting"
                }
                size="sm"
                tone={STATE_TONE[host.state]}
              />
              <span className={styles.stateLabel}>
                {STATE_LABEL[host.state]}
              </span>
            </span>
            <span className={styles.focus} aria-hidden={!host.focused}>
              {host.focused ? <CheckIcon size={12} /> : null}
            </span>
          </button>
          {!host.local && (
            <Button
              disabled={busyId === host.id}
              variant="ghost"
              onClick={() =>
                host.attached ? onDetach(host.id) : onAttach(host.id)
              }
            >
              {host.attached ? "Detach" : "Attach"}
            </Button>
          )}
        </div>
      ))}
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </div>
  );
}
