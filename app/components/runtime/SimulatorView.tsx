import { useCallback, useEffect, useRef } from "react";
import { useSimulatorCapture } from "../../hooks/useSimulatorCapture";
import { useSimulatorStore, isTvOS } from "../../stores/simulatorStore";
import {
  listSimulators,
  bootSimulator,
  startSimulatorCapture,
  stopSimulatorCapture,
  disconnectSimulator,
  simulatorTouch,
  simulatorKeyboard,
} from "../../lib/ipc";
import { KEYCODE_MAP, modifierFlagsFromEvent } from "../../lib/keycodeMap";
import { AppleTVRemote } from "./AppleTVRemote";
import { RunButton } from "./RunButton";
import { HomeIcon, DisconnectIcon, BootIcon } from "../shared/Icons";
import styles from "./SimulatorView.module.css";

const DRAG_THROTTLE_MS = 17; // ~60Hz — must exceed IndigoHID's internal 16ms throttle

interface SimulatorViewProps {
  workspaceId: null | string;
}

export function SimulatorView({ workspaceId }: SimulatorViewProps) {
  const {
    devices,
    selectedUdidByWorkspace,
    capturing,
    mjpegPort,
    booting,
    disconnected,
    setDevices,
    selectDevice,
    setCapturing,
    setBooting,
    setMjpegPort,
    setDisconnected,
  } = useSimulatorStore();

  const storeKey = workspaceId ?? "__global__";
  const selectedUdid = selectedUdidByWorkspace[storeKey] ?? null;
  const { imgRef, streamUrl, isReceiving } = useSimulatorCapture(
    capturing ? mjpegPort : null,
  );

  const selectedDevice = devices.find((d) => d.udid === selectedUdid);
  const isTv = isTvOS(selectedDevice);
  const isBooted = selectedDevice?.booted ?? false;
  const prevWorkspaceIdRef = useRef<null | string>(null);

  // --- Device management (absorbed from SimulatorControls) ---

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

  // When workspace changes: stop current capture
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
        console.error("Auto-capture failed:", err),
      );
    }
  }, [isBooted, capturing, booting, disconnected, selectedUdid, startCapture]);

  // --- Title bar handlers ---

  const handleDeviceChange = useCallback(
    async (udid: null | string) => {
      if (capturing) {
        try {
          await stopSimulatorCapture();
        } catch {
          // Capture may already be stopped
        }
        setCapturing(false);
        setMjpegPort(null);
      }
      selectDevice(storeKey, udid);
    },
    [capturing, storeKey, selectDevice, setCapturing, setMjpegPort],
  );

  const handleBoot = useCallback(async () => {
    if (!selectedUdid || booting) return;
    setBooting(true);
    setDisconnected(false);
    try {
      await bootSimulator(selectedUdid);
      await new Promise((r) => setTimeout(r, 2000));
      await startCapture(selectedUdid);
      refreshDevices();
    } catch (err) {
      console.error("Boot/capture failed:", err);
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
    if (!selectedUdid) return;
    try {
      await disconnectSimulator(selectedUdid);
      setCapturing(false);
      setMjpegPort(null);
      setDisconnected(false);
      selectDevice(storeKey, null);
    } catch (err) {
      console.error("Disconnect failed:", err);
    }
  }, [
    selectedUdid,
    storeKey,
    selectDevice,
    setCapturing,
    setMjpegPort,
    setDisconnected,
  ]);

  const handleHomePress = useCallback(async () => {
    const keyCode = KEYCODE_MAP["KeyH"];
    if (keyCode === undefined) return;
    // Cmd+Shift+H: Shift (0x20000) + Cmd (0x100000)
    const modifiers = 0x120000;
    try {
      await simulatorKeyboard(keyCode, modifiers, true);
      await new Promise((r) => setTimeout(r, 200));
      await simulatorKeyboard(keyCode, modifiers, false);
    } catch (err) {
      console.error("[Home] failed:", err);
    }
  }, []);

  // --- Touch / keyboard handlers ---

  const touchFailed = useRef(false);
  const lastDragTime = useRef(0);
  const isPointerDown = useRef(false);

  const getNormCoords = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const img = imgRef.current;
      if (!img) {
        const rect = e.currentTarget.getBoundingClientRect();
        return {
          x: (e.clientX - rect.left) / rect.width,
          y: (e.clientY - rect.top) / rect.height,
        };
      }

      const containerRect = e.currentTarget.getBoundingClientRect();
      const naturalW = img.naturalWidth;
      const naturalH = img.naturalHeight;
      const scale = Math.min(
        containerRect.width / naturalW,
        containerRect.height / naturalH,
      );
      const renderedW = naturalW * scale;
      const renderedH = naturalH * scale;
      const offsetX = (containerRect.width - renderedW) / 2;
      const offsetY = (containerRect.height - renderedH) / 2;

      return {
        x: Math.max(
          0,
          Math.min(
            0.9999,
            (e.clientX - containerRect.left - offsetX) / renderedW,
          ),
        ),
        y: Math.max(
          0,
          Math.min(
            0.9999,
            (e.clientY - containerRect.top - offsetY) / renderedH,
          ),
        ),
      };
    },
    [imgRef],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!selectedUdid) return;
      touchFailed.current = false;
      isPointerDown.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.classList.add("sim-touching");
      const { x, y } = getNormCoords(e);
      simulatorTouch(selectedUdid, x, y, 0).catch((err) => {
        console.error("[Touch] DOWN failed:", err);
        touchFailed.current = true;
      });
    },
    [selectedUdid, getNormCoords],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (
        !selectedUdid ||
        !isPointerDown.current ||
        e.buttons === 0 ||
        touchFailed.current
      )
        return;
      const now = performance.now();
      if (now - lastDragTime.current < DRAG_THROTTLE_MS) return;
      lastDragTime.current = now;
      const { x, y } = getNormCoords(e);
      simulatorTouch(selectedUdid, x, y, 1).catch((err) => {
        console.error("[Touch] DRAG failed:", err);
        touchFailed.current = true;
      });
    },
    [selectedUdid, getNormCoords],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!selectedUdid) return;
      isPointerDown.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
      document.body.classList.remove("sim-touching");
      const { x, y } = getNormCoords(e);
      simulatorTouch(selectedUdid, x, y, 2).catch(() => {});
    },
    [selectedUdid, getNormCoords],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.repeat) return;
      // Let Cmd+<key> shortcuts pass through to the host app,
      // except Cmd+Shift+H which is the iOS simulator Home button.
      const isCmdShiftH = e.metaKey && e.shiftKey && e.code === "KeyH";
      if (
        e.metaKey &&
        e.code !== "MetaLeft" &&
        e.code !== "MetaRight" &&
        !isCmdShiftH
      )
        return;
      const keyCode = KEYCODE_MAP[e.code];
      if (keyCode === undefined) return;
      e.preventDefault();
      simulatorKeyboard(keyCode, modifierFlagsFromEvent(e.nativeEvent), true);
    },
    [],
  );

  const handleKeyUp = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const isCmdShiftH = e.metaKey && e.shiftKey && e.code === "KeyH";
    if (
      e.metaKey &&
      e.code !== "MetaLeft" &&
      e.code !== "MetaRight" &&
      !isCmdShiftH
    )
      return;
    const keyCode = KEYCODE_MAP[e.code];
    if (keyCode === undefined) return;
    e.preventDefault();
    simulatorKeyboard(keyCode, modifierFlagsFromEvent(e.nativeEvent), false);
  }, []);

  // --- Title bar (always rendered) ---

  const titleBar = (
    <div className={styles.titleBar}>
      <span className={styles.titleBarLabel}>Simulator</span>
      <select
        className={styles.titleBarSelect}
        value={selectedUdid ?? ""}
        onChange={(e) => handleDeviceChange(e.target.value || null)}
        disabled={booting}
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
      <div className={styles.titleBarActions}>
        {!isBooted && !capturing && selectedUdid && (
          <button
            className={styles.titleBarButton}
            onClick={handleBoot}
            disabled={booting}
            title={booting ? "Booting..." : "Boot simulator"}
          >
            <BootIcon size={12} />
          </button>
        )}
        {capturing && (
          <button
            className={styles.titleBarButton}
            onClick={handleHomePress}
            title="Home (Cmd+Shift+H)"
          >
            <HomeIcon size={12} />
          </button>
        )}
        {(isBooted || capturing) && selectedUdid && (
          <button
            className={`${styles.titleBarButton} ${styles.titleBarButtonDestructive}`}
            onClick={handleDisconnect}
            title="Disconnect simulator"
          >
            <DisconnectIcon size={12} />
          </button>
        )}
        {workspaceId && <RunButton workspaceId={workspaceId} />}
      </div>
    </div>
  );

  // --- Render ---

  if (!capturing) {
    return (
      <div className={styles.iosLayout}>
        {titleBar}
        <div className={styles.placeholder}>
          {isTv ? (
            <div className={styles.tvFrame}>
              <div className={styles.tvScreen}>
                <p className={styles.phaseHint}>
                  Boot a tvOS simulator to see it here
                </p>
              </div>
              <div className={styles.tvStand} />
            </div>
          ) : (
            <div className={styles.phoneFrame}>
              <div className={styles.phoneScreen}>
                <p className={styles.phaseHint}>
                  Boot a simulator to see it here
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (isTv) {
    return (
      <div className={styles.tvLayout}>
        {titleBar}
        <div className={styles.canvasContainer}>
          {streamUrl && (
            <img
              ref={imgRef}
              src={streamUrl}
              className={`${styles.canvas} ${styles.tvCanvas}`}
              draggable={false}
              alt="Simulator"
            />
          )}
          {!isReceiving && (
            <div className={styles.connecting}>
              <p>Waiting for frames...</p>
            </div>
          )}
        </div>
        <AppleTVRemote />
      </div>
    );
  }

  return (
    <div
      className={styles.iosLayout}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      {titleBar}
      <div
        className={styles.canvasContainer}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {streamUrl && (
          <img
            ref={imgRef}
            src={streamUrl}
            className={styles.canvas}
            draggable={false}
            alt="Simulator"
          />
        )}
        {!isReceiving && (
          <div className={styles.connecting}>
            <p>Waiting for frames...</p>
          </div>
        )}
      </div>
    </div>
  );
}
