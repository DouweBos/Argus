import type { HostConnectionEntry, HostLinkState } from "@argus/peacock";
import type { ConnectionState } from "@argus/remote-client";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, HostConnectionList, Icons, StatusDot } from "@argus/peacock";
import { useOutsideClick } from "../../../hooks/useOutsideClick";
import {
  LOCAL_HOST_ID,
  attachTo,
  detachFrom,
  focusHost,
} from "../../../lib/transport";
import {
  useFocusedConnection,
  useHostConnections,
  useUnreachableHosts,
} from "../../../stores/connectionStore";
import {
  showSettingsDialog,
  useAttachedRemoteHostIds,
  useRemoteHosts,
} from "../../../stores/settingsStore";
import styles from "./ConnectionPicker.module.css";

const STATE_TONE = {
  connecting: "warning",
  handshaking: "warning",
  offline: "error",
  ready: "success",
} as const satisfies Record<ConnectionState, "error" | "success" | "warning">;

/**
 * A socket that dropped after being up is reconnecting on its own backoff —
 * worth distinguishing from one that never came up.
 */
function linkState(
  attached: boolean,
  state: ConnectionState | null,
  unreachable: boolean,
): HostLinkState {
  if (unreachable) {
    return "failed";
  }
  if (!attached || !state) {
    return "detached";
  }
  switch (state) {
    case "ready":
      return "connected";
    case "offline":
      return "reconnecting";
    default:
      return "connecting";
  }
}

/**
 * Which machines this window is driving, and which one the view reads from.
 * Several hosts run at once, so focusing and attaching are separate acts: one
 * is a route change, the other a transport that outlives the view.
 */
export function ConnectionPicker() {
  const focused = useFocusedConnection();
  const connections = useHostConnections();
  const hosts = useRemoteHosts();
  const attachedIds = useAttachedRemoteHostIds();
  const unreachable = useUnreachableHosts();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  useOutsideClick(panelRef, open, () => setOpen(false));

  const remote = focused.mode === "remote";
  const entries: HostConnectionEntry[] = [
    {
      id: LOCAL_HOST_ID,
      label: "This Mac",
      local: true,
      attached: true,
      focused: !remote,
      state: "connected",
    },
    ...hosts.map((host): HostConnectionEntry => {
      const attached = attachedIds.includes(host.id);

      return {
        id: host.id,
        label: host.label,
        attached,
        focused: host.id === focused.hostId,
        detail: host.url.replace(/^wss?:\/\//, ""),
        state: linkState(
          attached,
          connections.find((c) => c.hostId === host.id)?.state ?? null,
          unreachable.includes(host.label),
        ),
      };
    }),
  ];

  /** Attach/detach can take a round trip; keep the row quiet meanwhile. */
  const run = (hostId: string, action: Promise<void>) => {
    setBusyId(hostId);
    action.catch(() => undefined).finally(() => setBusyId(null));
  };

  return (
    <>
      <button
        className={styles.trigger}
        title={
          remote
            ? `Reading from ${focused.label}`
            : "This view reads from this Mac"
        }
        type="button"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchor({ x: rect.right - 260, y: rect.bottom + 4 });
          setOpen((was) => !was);
        }}
      >
        {remote ? <Icons.HostIcon size={12} /> : <Icons.LaptopIcon size={12} />}
        <span className={styles.label}>{focused.label}</span>
        {attachedIds.length > 0 && (
          <span className={styles.count}>{attachedIds.length + 1}</span>
        )}
        {remote && (
          <StatusDot
            tone={STATE_TONE[focused.state]}
            pulse={focused.state !== "ready"}
          />
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className={styles.panel}
            style={{ left: anchor.x, top: anchor.y }}
          >
            <p className={styles.heading}>Machines</p>
            <HostConnectionList
              busyId={busyId}
              hosts={entries}
              footer={
                <Button
                  variant="ghost"
                  onClick={() => {
                    setOpen(false);
                    showSettingsDialog("hosts");
                  }}
                >
                  {hosts.length > 0 ? "Manage hosts…" : "Pair a host…"}
                </Button>
              }
              onAttach={(id) => run(id, attachTo(id))}
              onDetach={(id) => run(id, detachFrom(id))}
              onFocus={(id) => {
                setOpen(false);
                focusHost(id).catch(() => undefined);
              }}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
