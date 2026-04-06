import { useCallback, useEffect, useRef } from "react";
import { useSimulatorStore, isTvOS } from "../../stores/simulatorStore";
import {
  checkIosTools,
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
import { DeviceStreamView } from "./DeviceStreamView";
import { RunButton } from "./RunButton";
import { HomeIcon, DisconnectIcon, BootIcon } from "../shared/Icons";
import styles from "./SimulatorView.module.css";

interface IosSimulatorViewProps {
  children?: React.ReactNode;
  workspaceId: null | string;
}

export function IosSimulatorView({
  children,
  workspaceId,
}: IosSimulatorViewProps) {
  const {
    iosToolsAvailable,
    setIosToolsStatus,
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

  const selectedDevice = devices.find((d) => d.udid === selectedUdid);
  const isTv = isTvOS(selectedDevice);
  const isBooted = selectedDevice?.booted ?? false;
  const prevWorkspaceIdRef = useRef<null | string>(null);

  // --- Tool availability check ---

  useEffect(() => {
    checkIosTools()
      .then(() => setIosToolsStatus(true, null))
      .catch((err) => setIosToolsStatus(false, String(err)));
  }, [setIosToolsStatus]);

  // --- Device polling ---

  const refreshDevices = useCallback(() => {
    listSimulators()
      .then((devs) => {
        setDevices(devs);
        if (!iosToolsAvailable) setIosToolsStatus(true, null);
      })
      .catch(() => {
        checkIosTools()
          .then(() => setIosToolsStatus(true, null))
          .catch((err) => setIosToolsStatus(false, String(err)));
      });
  }, [setDevices, iosToolsAvailable, setIosToolsStatus]);

  useEffect(() => {
    if (iosToolsAvailable === false) return;
    refreshDevices();
    const interval = setInterval(refreshDevices, 5000);
    return () => clearInterval(interval);
  }, [refreshDevices, iosToolsAvailable]);

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
    const modifiers = 0x120000; // Cmd+Shift
    try {
      await simulatorKeyboard(keyCode, modifiers, true);
      await new Promise((r) => setTimeout(r, 200));
      await simulatorKeyboard(keyCode, modifiers, false);
    } catch (err) {
      console.error("[Home] failed:", err);
    }
  }, []);

  // --- Touch / keyboard callbacks ---

  const handleTouch = useCallback(
    (x: number, y: number, eventType: number) => {
      if (!selectedUdid) return;
      simulatorTouch(selectedUdid, x, y, eventType).catch((err) => {
        console.error("[Touch] failed:", err);
      });
    },
    [selectedUdid],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.repeat) return;
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

  // --- Device picker ---

  const devicePicker = (
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
  );

  const actionButtons = (
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
  );

  // --- Placeholder ---

  const placeholderContent = isTv ? (
    <div className={styles.tvFrame}>
      <div className={styles.tvScreen}>
        <p className={styles.phaseHint}>Boot a tvOS simulator to see it here</p>
      </div>
      <div className={styles.tvStand} />
    </div>
  ) : (
    <div className={styles.phoneFrame}>
      <div className={styles.phoneScreen}>
        <p className={styles.phaseHint}>Boot a simulator to see it here</p>
      </div>
    </div>
  );

  // --- tvOS custom stream layout (canvas + remote side by side) ---

  const renderTvStream = isTv
    ? ({
        imgRef,
        streamUrl,
        isReceiving,
      }: {
        imgRef: React.RefObject<HTMLImageElement | null>;
        isReceiving: boolean;
        streamUrl: null | string;
      }) => (
        <div className={styles.tvBody}>
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
      )
    : undefined;

  return (
    <DeviceStreamView
      capturing={capturing}
      mjpegPort={mjpegPort}
      toolsAvailable={iosToolsAvailable}
      toolsMissing={{
        title: "Xcode Command Line Tools Required",
        body: (
          <p className={styles.phaseHint}>
            Run <code>xcode-select --install</code> in Terminal to install them.
          </p>
        ),
      }}
      devicePicker={devicePicker}
      actionButtons={actionButtons}
      placeholder={placeholderContent}
      onTouch={handleTouch}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      renderStream={renderTvStream}
      streamAlt="Simulator"
    >
      {children}
    </DeviceStreamView>
  );
}
