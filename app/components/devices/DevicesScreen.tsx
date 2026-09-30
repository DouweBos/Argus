import type { DeviceInfo } from "../../lib/types";
import { useEffect, useMemo, useState } from "react";
import {
  Chip,
  ContextMenu,
  type ContextMenuItem,
  Icons,
  SegmentedControl,
  Slider,
} from "@argus/peacock";
import {
  useVideoInputDevicesState,
  videoInputLabel,
} from "../../hooks/useVideoInputDevices";
import { bootSimulator, openDevicePopout, stopDevice } from "../../lib/ipc";
import {
  MAX_TILE_SIZE,
  MIN_TILE_SIZE,
  pruneGridSelection,
  setDevicesViewMode,
  setGridTileSize,
  toggleGridSelected,
  useDeviceGridSelection,
  useDevicesViewMode,
  useGridTileSize,
} from "../../stores/deviceGridStore";
import { deviceKeyFor, refreshDevices } from "../../stores/deviceStore";
import {
  useDevicePoller,
  useDevices,
  useDevicesError,
} from "../../stores/deviceStore";
import { DeviceDialog } from "./DeviceDialog/DeviceDialog";
import { DeviceGrid } from "./DeviceGrid/DeviceGrid";
import styles from "./DevicesScreen.module.css";
import { useDeviceNavigation } from "./deviceNav";

function platformIcon(platform: DeviceInfo["platform"]) {
  if (platform === "web") {
    return <Icons.WebIcon size={10} />;
  }
  if (platform === "video") {
    return <Icons.VideoIcon size={10} />;
  }

  return <Icons.SimulatorIcon size={10} />;
}

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}

interface MenuState {
  device: DeviceInfo;
  x: number;
  y: number;
}

export function DevicesScreen() {
  useDevicePoller(3000);
  const backendDevices = useDevices();
  const { devices: videoInputs, ready: videoInputsReady } =
    useVideoInputDevicesState();
  const error = useDevicesError();

  // Video inputs (capture cards / cameras) live in the renderer — surface them
  // as view-only device rows alongside the backend-polled simulators.
  const devices = useMemo<DeviceInfo[]>(() => {
    const video: DeviceInfo[] = videoInputs.map((d, i) => ({
      agentId: null,
      deviceKey: d.deviceId,
      name: videoInputLabel(d, i),
      online: true,
      platform: "video",
      repoRoot: null,
      reservationKey: d.deviceId,
      reserved: false,
      sessionId: null,
      sessionPath: null,
    }));

    return [...backendDevices, ...video];
  }, [backendDevices, videoInputs]);
  const { goto } = useDeviceNavigation();
  const [open, setOpen] = useState<DeviceInfo | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const viewMode = useDevicesViewMode();
  const tileSize = useGridTileSize();
  const { selectedKeys, interactiveKeys } = useDeviceGridSelection();

  const onlineDevices = useMemo(
    () => devices.filter((d) => d.online),
    [devices],
  );

  // Drop grid selections whose device is no longer online/present. Wait for the
  // async video-input enumeration, else remounting prunes every video input.
  useEffect(() => {
    if (!videoInputsReady) {
      return;
    }
    pruneGridSelection(onlineDevices.map((d) => d.deviceKey));
  }, [onlineDevices, videoInputsReady]);

  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const interactiveSet = useMemo(
    () => new Set(interactiveKeys),
    [interactiveKeys],
  );

  // Grid tiles in selection order, filtered to devices still online.
  const gridDevices = useMemo(
    () =>
      selectedKeys
        .map((k) => onlineDevices.find((d) => d.deviceKey === k))
        .filter((d): d is DeviceInfo => d != null),
    [selectedKeys, onlineDevices],
  );

  const nav =
    (kind: "agent" | "project" | "session", d: DeviceInfo) =>
    (e: React.MouseEvent) => {
      e.stopPropagation();
      goto(d, kind).catch(() => {});
    };

  const handleContextMenu = (d: DeviceInfo) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Video inputs are view-only — no stop/boot actions.
    if (d.platform === "video") {
      return;
    }
    setMenu({ device: d, x: e.clientX, y: e.clientY });
  };

  const handlePopout =
    (d: DeviceInfo) => (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      openDevicePopout({
        platform: d.platform,
        deviceKey: d.deviceKey,
        name: d.name,
      }).catch(() => {
        // best-effort — the backend logs failures
      });
    };

  const [booting, setBooting] = useState<Set<string>>(new Set());

  const handleBoot =
    (d: DeviceInfo) => async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      if (d.platform !== "ios" || booting.has(d.deviceKey)) {
        return;
      }
      setBooting((prev) => new Set(prev).add(d.deviceKey));
      try {
        await bootSimulator(d.deviceKey);
        await refreshDevices();
      } catch {
        // Next poll will reflect whatever state the simulator ended up in.
      } finally {
        setBooting((prev) => {
          const next = new Set(prev);
          next.delete(d.deviceKey);

          return next;
        });
      }
    };

  const handleStop = async (d: DeviceInfo) => {
    // Video inputs live in the renderer; there is nothing on the host to stop.
    if (d.platform === "video") {
      return;
    }
    try {
      await stopDevice(d.platform, d.deviceKey);
      await refreshDevices();
    } catch {
      // Swallow — the next poll will show the device state either way.
    }
  };

  const menuItems: ContextMenuItem[] = menu
    ? [
        {
          label: "Stop device",
          danger: true,
          disabled: !menu.device.online,
          onClick: () => {
            handleStop(menu.device);
          },
        },
      ]
    : [];

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <span className={styles.title}>Devices</span>
        <span className={styles.sub}>
          {devices.length} total · {onlineDevices.length} running ·{" "}
          {devices.filter((d) => d.reserved).length} reserved
        </span>
        <div className={styles.headControls}>
          <SegmentedControl
            aria-label="Devices view"
            value={viewMode}
            onChange={setDevicesViewMode}
            options={[
              { label: "Table", value: "table" as const },
              { label: "Grid", value: "grid" as const },
            ]}
          />
          {viewMode === "grid" && (
            <Slider
              aria-label="Tile size"
              className={styles.tileSlider}
              min={MIN_TILE_SIZE}
              max={MAX_TILE_SIZE}
              step={10}
              value={tileSize}
              onChange={setGridTileSize}
            />
          )}
        </div>
      </div>

      {error && (
        <div className={styles.empty} style={{ color: "var(--error)" }}>
          Failed to list devices: {error}
        </div>
      )}

      {devices.length === 0 && !error && (
        <div className={styles.empty}>
          No devices found. Start an agent or boot a simulator to see devices
          here.
        </div>
      )}

      {viewMode === "grid" && devices.length > 0 && (
        <>
          {onlineDevices.length > 0 && (
            <div className={styles.pillBar}>
              {onlineDevices.map((d) => (
                <Chip
                  key={`${d.platform}:${deviceKeyFor(d)}`}
                  interactive
                  selected={selectedSet.has(d.deviceKey)}
                  leading={
                    <span className={styles.pillIcon}>
                      {platformIcon(d.platform)}
                    </span>
                  }
                  onClick={() => toggleGridSelected(d.deviceKey)}
                >
                  {d.name}
                </Chip>
              ))}
            </div>
          )}
          <DeviceGrid
            devices={gridDevices}
            interactiveKeys={interactiveSet}
            tileSize={tileSize}
          />
        </>
      )}

      {viewMode === "table" && devices.length > 0 && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Device</th>
              <th>Platform</th>
              <th>Runtime</th>
              <th>Agent</th>
              <th>Session</th>
              <th>Project</th>
              <th className={styles.actionCell} aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr
                key={`${d.platform}:${deviceKeyFor(d)}`}
                className={styles.row}
                onClick={() => setOpen(d)}
                onContextMenu={handleContextMenu(d)}
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
                  {d.sessionId ? (
                    <button className={styles.link} onClick={nav("session", d)}>
                      {d.sessionId.slice(0, 8)}
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
                <td className={styles.actionCell}>
                  {d.platform === "ios" && (
                    <>
                      {!d.online && (
                        <button
                          className={styles.iconBtn}
                          disabled={booting.has(d.deviceKey)}
                          title={
                            booting.has(d.deviceKey)
                              ? "Booting..."
                              : "Boot simulator"
                          }
                          type="button"
                          onClick={handleBoot(d)}
                        >
                          <Icons.BootIcon size={11} />
                        </button>
                      )}
                      {d.online && (
                        <button
                          className={styles.iconBtn}
                          title="Shut down simulator"
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStop(d).catch(() => {});
                          }}
                        >
                          <Icons.DisconnectIcon size={11} />
                        </button>
                      )}
                    </>
                  )}
                  {d.platform !== "web" && (
                    <button
                      className={styles.iconBtn}
                      title="Open in floating window"
                      type="button"
                      onClick={handlePopout(d)}
                    >
                      <Icons.PopoutIcon size={11} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {open && <DeviceDialog device={open} onClose={() => setOpen(null)} />}

      {menu && (
        <ContextMenu
          items={menuItems}
          position={{ x: menu.x, y: menu.y }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
