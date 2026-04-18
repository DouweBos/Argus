import type { DeviceInfo } from "../../lib/types";
import { useState } from "react";
import {
  useDevicePoller,
  useDevices,
  useDevicesError,
} from "../../stores/deviceStore";
import { DeviceDialog } from "./DeviceDialog/DeviceDialog";
import styles from "./DevicesScreen.module.css";
import { useDeviceNavigation } from "./deviceNav";

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}

export function DevicesScreen() {
  useDevicePoller(3000);
  const devices = useDevices();
  const error = useDevicesError();
  const { goto } = useDeviceNavigation();
  const [open, setOpen] = useState<DeviceInfo | null>(null);

  const nav =
    (kind: "agent" | "project" | "workspace", d: DeviceInfo) =>
    (e: React.MouseEvent) => {
      e.stopPropagation();
      goto(d, kind).catch(() => {});
    };

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <span className={styles.title}>Devices</span>
        <span className={styles.sub}>
          {devices.length} total · {devices.filter((d) => d.online).length}{" "}
          running · {devices.filter((d) => d.reserved).length} reserved
        </span>
      </div>

      {error && (
        <div className={styles.empty} style={{ color: "#ff8ea0" }}>
          Failed to list devices: {error}
        </div>
      )}

      {devices.length === 0 && !error ? (
        <div className={styles.empty}>
          No devices found. Start an agent or boot a simulator to see devices
          here.
        </div>
      ) : devices.length === 0 ? null : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Device</th>
              <th>Platform</th>
              <th>Runtime</th>
              <th>Agent</th>
              <th>Workspace</th>
              <th>Project</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr
                key={`${d.platform}:${d.deviceKey}`}
                className={styles.row}
                onClick={() => setOpen(d)}
              >
                <td className={styles.name}>
                  <span
                    className={`${styles.statusDot} ${d.online ? styles.on : ""}`}
                    aria-label={d.online ? "online" : "offline"}
                  />
                  {d.name}
                </td>
                <td>
                  <span className={styles.platformBadge}>{d.platform}</span>
                </td>
                <td className={styles.muted}>{d.runtime ?? "—"}</td>
                <td>
                  {d.agentId ? (
                    <button className={styles.link} onClick={nav("agent", d)}>
                      {d.agentId.slice(0, 8)}
                    </button>
                  ) : (
                    <span className={styles.dash}>—</span>
                  )}
                </td>
                <td>
                  {d.workspaceId ? (
                    <button
                      className={styles.link}
                      onClick={nav("workspace", d)}
                    >
                      {d.workspaceId.slice(0, 8)}
                    </button>
                  ) : (
                    <span className={styles.dash}>—</span>
                  )}
                </td>
                <td>
                  {d.repoRoot ? (
                    <button className={styles.link} onClick={nav("project", d)}>
                      {basename(d.repoRoot)}
                    </button>
                  ) : (
                    <span className={styles.dash}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {open && <DeviceDialog device={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
