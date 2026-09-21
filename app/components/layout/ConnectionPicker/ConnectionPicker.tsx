import type { ConnectionState } from "@argus/remote-client";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, HostConnectionList, Icons, StatusDot } from "@argus/peacock";
import { useHostEntries } from "../../../hooks/useHostEntries";
import { useOutsideClick } from "../../../hooks/useOutsideClick";
import { useFocusedConnection } from "../../../stores/connectionStore";
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
 * Which machines this window is driving. Attaching and detaching live here;
 * which machine you are *looking at* is the window tab you are on, so picking
 * a row opens or brings forward that machine's tab rather than re-pointing
 * whatever is on screen.
 */
export function ConnectionPicker() {
  const focused = useFocusedConnection();
  const hosts = useRemoteHosts();
  const attachedIds = useAttachedRemoteHostIds();
  const { entries, busyId, attach, detach, focus } = useHostEntries();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ right: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  useOutsideClick(panelRef, open, () => setOpen(false));

  const remote = focused.mode === "remote";

  return (
    <>
      <button
        className={styles.trigger}
        title="Machines — attach, detach and pair"
        type="button"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          // Pinned by its right edge so the panel can grow leftward with a
          // long host name instead of being clipped at a fixed width.
          setAnchor({
            right: window.innerWidth - rect.right,
            y: rect.bottom + 4,
          });
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
            style={{ right: anchor.right, top: anchor.y }}
          >
            <p className={styles.heading}>Machines</p>
            <p className={styles.hint}>Pick a machine to open its tab</p>
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
              onAttach={attach}
              onDetach={detach}
              onFocus={(id) => {
                setOpen(false);
                focus(id);
              }}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
