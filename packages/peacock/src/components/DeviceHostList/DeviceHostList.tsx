import type { ReactNode } from "react";
import { WarningIcon } from "../../icons/Icons";
import { Banner } from "../Banner/Banner";
import { Button } from "../Button/Button";
import { EmptyState } from "../EmptyState/EmptyState";
import { Spinner } from "../Spinner/Spinner";
import { StatusBulb } from "../StatusBulb/StatusBulb";
import styles from "./DeviceHostList.module.css";

export interface DeviceHostRowData {
  id: string;
  label: string;
  kind: "eas" | "ssh";
  /** "Connected", or for EAS "EAS · 1 of 2 running". */
  statusLabel: string;
  tone: "error" | "neutral" | "success" | "warning";
  /** EAS at its session limit: Start is disabled. */
  full?: boolean;
}

export interface DeviceHostNote {
  text: string;
  failed?: boolean;
}

export interface DeviceHostListProps {
  /** Null while loading. */
  hosts: DeviceHostRowData[] | null;
  /** Why the last load failed. */
  error?: string | null;
  onRetry?: () => void;
  /** Start an EAS session; omit for a client that can't (monitor-only). */
  onStart?: (hostId: string) => void;
  /** The host with a start in flight. */
  busyId?: string | null;
  /** A line under a host's row: "Starting…", or why it failed. */
  notes?: Record<string, DeviceHostNote | undefined>;
  /** Rendered under the rows, e.g. where hosts are managed. */
  footer?: ReactNode;
}

const KIND_LABEL: Record<DeviceHostRowData["kind"], string> = {
  eas: "EAS Simulator",
  ssh: "Mac over SSH",
};

/**
 * Other Macs a computer streams simulators from, and EAS Simulator hosts in
 * Expo's cloud. An EAS row can start a (billed) session; confirm before
 * calling `onStart`.
 */
export function DeviceHostList({
  hosts,
  error,
  onRetry,
  onStart,
  busyId,
  notes,
  footer,
}: DeviceHostListProps) {
  const retry = onRetry && (
    <Button size="sm" variant="secondary" onClick={onRetry}>
      Retry
    </Button>
  );

  if (hosts === null) {
    return error ? (
      <EmptyState
        action={retry}
        body={error}
        icon={<WarningIcon size={22} />}
        title="Couldn't load device hosts"
      />
    ) : (
      <div className={styles.loading}>
        <Spinner size="sm" />
        <span>Loading device hosts…</span>
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {hosts.length === 0 ? (
        <p className={styles.empty}>No device hosts on this computer.</p>
      ) : (
        <ul className={styles.rows}>
          {hosts.map((h) => {
            const note = notes?.[h.id];
            const busy = busyId === h.id;

            return (
              <li key={h.id} className={styles.row}>
                <div className={styles.head}>
                  <StatusBulb size="sm" tone={h.tone} />
                  <div className={styles.text}>
                    <span className={styles.name}>{h.label}</span>
                    <span className={styles.kind}>{KIND_LABEL[h.kind]}</span>
                  </div>
                  <span
                    className={[
                      styles.status,
                      h.tone === "warning" || h.tone === "error"
                        ? styles[h.tone]
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {h.statusLabel}
                  </span>
                  {h.kind === "eas" && onStart && (
                    <Button
                      disabled={busy || h.full === true}
                      size="sm"
                      variant="secondary"
                      onClick={() => onStart(h.id)}
                    >
                      {busy ? "Starting…" : "Start a session"}
                    </Button>
                  )}
                </div>
                {note && (
                  <p className={note.failed ? styles.failure : styles.note}>
                    {note.text}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {hosts.length > 0 && error && (
        <Banner tone="error" trailing={retry}>
          {error}
        </Banner>
      )}
      {footer && <div className={styles.footer}>{footer}</div>}
    </div>
  );
}
