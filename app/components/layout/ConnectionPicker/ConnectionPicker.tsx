import type { ContextMenuItem, ContextMenuPosition } from "@argus/peacock";
import { useState } from "react";
import { ContextMenu, Icons, StatusDot } from "@argus/peacock";
import { switchConnection } from "../../../lib/transport";
import { useConnection } from "../../../stores/connectionStore";
import {
  showSettingsDialog,
  useActiveRemoteHostId,
  useRemoteHosts,
} from "../../../stores/settingsStore";
import styles from "./ConnectionPicker.module.css";

const STATE_TONE = {
  connecting: "warning",
  handshaking: "warning",
  offline: "error",
  ready: "success",
} as const;

const STATE_LABEL: Record<string, string> = {
  connecting: "connecting",
  handshaking: "connecting",
  offline: "disconnected",
  ready: "connected",
};

/**
 * Which machine runs the agents. Transport, not route — attaching elsewhere
 * reloads the window rather than deep-linking, so a shared URL can never point
 * at a Mac the recipient cannot reach.
 */
export function ConnectionPicker() {
  const connection = useConnection();
  const hosts = useRemoteHosts();
  const activeId = useActiveRemoteHostId();
  const [menu, setMenu] = useState<ContextMenuPosition | null>(null);

  const remote = connection.mode === "remote";
  const label = remote ? (connection.hostLabel ?? "Host") : "This Mac";

  const items: ContextMenuItem[] = [
    { header: "Run agents on" },
    {
      label: "This Mac",
      icon: <Icons.LaptopIcon size={12} />,
      selected: !remote,
      onClick: () => !remote || switchConnection(null),
    },
    ...hosts.map(
      (host): ContextMenuItem => ({
        label: host.label,
        icon: <Icons.HostIcon size={12} />,
        selected: host.id === activeId,
        trailing:
          host.id === activeId ? STATE_LABEL[connection.state] : undefined,
        onClick: () => host.id === activeId || switchConnection(host.id),
      }),
    ),
    { separator: true },
    {
      label: hosts.length > 0 ? "Manage hosts…" : "Pair a host…",
      icon: <Icons.GearIcon size={12} />,
      onClick: () => showSettingsDialog("hosts"),
    },
  ];

  return (
    <>
      <button
        className={styles.trigger}
        title={
          remote
            ? `Attached to ${label} — ${STATE_LABEL[connection.state]}`
            : "Agents run on this Mac"
        }
        type="button"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setMenu({ x: rect.left, y: rect.bottom + 4 });
        }}
      >
        {remote ? <Icons.HostIcon size={12} /> : <Icons.LaptopIcon size={12} />}
        <span className={styles.label}>{label}</span>
        {remote && (
          <StatusDot
            tone={STATE_TONE[connection.state]}
            pulse={connection.state !== "ready"}
          />
        )}
      </button>
      {menu && (
        <ContextMenu
          items={items}
          position={menu}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
