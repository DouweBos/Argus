import { useCallback, useEffect, useRef } from "react";
import { error } from "@logger";
import {
  bootSimulator,
  disconnectSimulator,
  listSimulators,
  startSimulatorCapture,
  stopSimulatorCapture,
} from "../../../lib/ipc";
import { useSimulatorControlsState } from "../../../stores/simulatorStore";
import { BootIcon, DisconnectIcon } from "../../shared/Icons";
import styles from "./SimulatorControls.module.css";

interface SimulatorControlsProps {
  workspaceId: string | null;
}

export function SimulatorControls({ workspaceId }: SimulatorControlsProps) {
  const {
    devices,
    selectedUdidByWorkspace,
    capturing,
    booting,
    disconnected,
    setDevices,
    selectDevice,
    setCapturing,
    setBooting,
    setDisconnected,
    setMjpegPort,
  } = useSimulatorControlsState();

  // Use a global key when no workspace is selected so the simulator works from the home screen.
  const storeKey = workspaceId ?? "__global__";
  const selectedUdid = selectedUdidByWorkspace[storeKey] ?? null;
  const selectedDevice = devices.find((d) => d.udid === selectedUdid);
  const prevWorkspaceIdRef = useRef<string | null>(null);

  // When workspace (storeKey) changes: stop current capture so we switch to
  // the new workspace's simulator. This also handles switching from home → workspace
  // or workspace → home.
  useEffect(() => {
    if (
      storeKey !== prevWorkspaceIdRef.current &&
      prevWorkspaceIdRef.current !== null
    ) {
      stopSimulatorCapture()
        .then(() => {
          setCapturing(false);
          setMjpegPort(null);
          setDisconnected(false);
        })
        .catch(() => {
          setCapturing(false);
          setMjpegPort(null);
          setDisconnected(false);
        });
    }

    prevWorkspaceIdRef.current = storeKey;
  }, [storeKey, setCapturing, setMjpegPort, setDisconnected]);
  const isBooted = selectedDevice?.booted ?? false;

  const refreshDevices = useCallback(() => {
    listSimulators()
      .then(setDevices)
      .catch(() => {});
  }, [setDevices]);

  // Poll devices on mount and every 5s
  useEffect(() => {
    refreshDevices();
    const interval = setInterval(refreshDevices, 5000);

    return () => clearInterval(interval);
  }, [refreshDevices]);

  const startCapture = useCallback(
    async (udid: string) => {
      const port = await startSimulatorCapture(udid);
      setMjpegPort(port);
      setCapturing(true);
    },
    [setMjpegPort, setCapturing],
  );

  // Auto-start capture if selected device is already booted externally
  useEffect(() => {
    if (isBooted && !capturing && !booting && !disconnected && selectedUdid) {
      startCapture(selectedUdid).catch((err) =>
        error("Auto-capture failed:", err),
      );
    }
  }, [isBooted, capturing, booting, disconnected, selectedUdid, startCapture]);

  const handleBoot = useCallback(async () => {
    if (!selectedUdid || booting) {
      return;
    }
    setBooting(true);
    setDisconnected(false);
    try {
      await bootSimulator(selectedUdid);
      // Wait a moment for the simulator to fully boot
      await new Promise((r) => setTimeout(r, 2000));
      await startCapture(selectedUdid);
      refreshDevices();
    } catch (err) {
      error("Boot/capture failed:", err);
    } finally {
      setBooting(false);
    }
  }, [
    selectedUdid,
    booting,
    setBooting,
    setDisconnected,
    startCapture,
    refreshDevices,
  ]);

  const handleDisconnect = useCallback(async () => {
    if (!selectedUdid) {
      return;
    }
    try {
      await disconnectSimulator(selectedUdid);
      setCapturing(false);
      setMjpegPort(null);
      setDisconnected(true);
    } catch (err) {
      error("Disconnect failed:", err);
    }
  }, [selectedUdid, setCapturing, setMjpegPort, setDisconnected]);

  return (
    <div className={styles.controls}>
      <div className={styles.deviceRow}>
        <span className={styles.label}>Device</span>
        <select
          className={styles.select}
          disabled={booting}
          value={selectedUdid ?? ""}
          onChange={async (e) => {
            const udid = e.target.value || null;
            if (capturing) {
              try {
                await stopSimulatorCapture();
              } catch {
                // Capture may already be stopped — continue with selection
              }

              setCapturing(false);
              setMjpegPort(null);
            }

            selectDevice(storeKey, udid);
          }}
        >
          <option value="">
            {devices.length === 0 ? "No simulators" : "Select simulator..."}
          </option>
          {devices.map((d) => {
            const baseName = d.name.replace(/\s*-\s*\d+\s*$/, "");
            const similarCount = devices.filter(
              (x) =>
                x.runtime === d.runtime &&
                x.name.replace(/\s*-\s*\d+\s*$/, "") === baseName,
            ).length;
            const suffix = similarCount > 1 ? ` [${d.udid.slice(-8)}]` : "";

            return (
              <option key={d.udid} value={d.udid}>
                {d.name}
                {suffix} ({d.runtime}){d.booted ? " - Booted" : ""}
              </option>
            );
          })}
        </select>
      </div>
      <div className={styles.actions}>
        {!isBooted && !capturing ? (
          <button
            className={styles.actionBtn}
            disabled={!selectedUdid || booting}
            onClick={handleBoot}
          >
            <BootIcon />
            {booting ? "Booting..." : "Boot"}
          </button>
        ) : (
          <button
            className={`${styles.actionBtn} ${styles.destructive}`}
            disabled={!selectedUdid}
            onClick={handleDisconnect}
          >
            <DisconnectIcon />
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}
