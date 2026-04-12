import { useCallback, useEffect, useRef } from "react";
import { error } from "@logger";
import {
  bootSimulator,
  checkIosTools,
  disconnectSimulator,
  listSimulators,
  simulatorButton,
  simulatorKeyboard,
  simulatorTouch,
  startSimulatorCapture,
  stopSimulatorCapture,
} from "../../../lib/ipc";
import { KEYCODE_MAP, modifierFlagsFromEvent } from "../../../lib/keycodeMap";
import {
  isTvOS,
  useIosSimulatorViewState,
} from "../../../stores/simulatorStore";
import { BootIcon, DisconnectIcon, HomeIcon } from "../../shared/Icons";
import chrome from "../RuntimeChrome.module.css";
import { AppleTVRemote } from "./AppleTVRemote";
import { IosDeviceStreamView } from "./IosDeviceStreamView";
import { RunButton } from "./RunButton";
import styles from "./RuntimeView.module.css";

interface IosSimulatorViewProps {
  children?: React.ReactNode;
  workspaceId: string | null;
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
  } = useIosSimulatorViewState();

  const storeKey = workspaceId ?? "__global__";
  const selectedUdid = selectedUdidByWorkspace[storeKey] ?? null;

  const selectedDevice = devices.find((d) => d.udid === selectedUdid);
  const isTv = isTvOS(selectedDevice);
  const isBooted = selectedDevice?.booted ?? false;
  const prevWorkspaceIdRef = useRef<string | null>(null);

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
        if (!iosToolsAvailable) {
          setIosToolsStatus(true, null);
        }
      })
      .catch(() => {
        checkIosTools()
          .then(() => setIosToolsStatus(true, null))
          .catch((err) => setIosToolsStatus(false, String(err)));
      });
  }, [setDevices, iosToolsAvailable, setIosToolsStatus]);

  useEffect(() => {
    if (iosToolsAvailable === false) {
      return;
    }
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
        error("Auto-capture failed:", err),
      );
    }
  }, [isBooted, capturing, booting, disconnected, selectedUdid, startCapture]);

  // --- Title bar handlers ---

  const handleDeviceChange = useCallback(
    async (udid: string | null) => {
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
    if (!selectedUdid || booting) {
      return;
    }
    setBooting(true);
    setDisconnected(false);
    try {
      await bootSimulator(selectedUdid);
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
      setDisconnected(false);
      selectDevice(storeKey, null);
    } catch (err) {
      error("Disconnect failed:", err);
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
    try {
      await simulatorButton("ios_home");
    } catch (err) {
      error("[Home] failed:", err);
    }
  }, []);

  // --- Touch / keyboard callbacks ---

  const handleTouch = useCallback(
    (x: number, y: number, eventType: number) => {
      if (!selectedUdid) {
        return;
      }
      simulatorTouch(selectedUdid, x, y, eventType).catch((err) => {
        error("[Touch] failed:", err);
      });
    },
    [selectedUdid],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.repeat) {
        return;
      }
      const isCmdShiftH = e.metaKey && e.shiftKey && e.code === "KeyH";
      if (
        e.metaKey &&
        e.code !== "MetaLeft" &&
        e.code !== "MetaRight" &&
        !isCmdShiftH
      ) {
        return;
      }
      const keyCode = KEYCODE_MAP[e.code];
      if (keyCode === undefined) {
        return;
      }
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
    ) {
      return;
    }
    const keyCode = KEYCODE_MAP[e.code];
    if (keyCode === undefined) {
      return;
    }
    e.preventDefault();
    simulatorKeyboard(keyCode, modifierFlagsFromEvent(e.nativeEvent), false);
  }, []);

  // --- Device picker ---

  const devicePicker = (
    <select
      className={chrome.titleBarSelect}
      disabled={booting}
      value={selectedUdid ?? ""}
      onChange={(e) => handleDeviceChange(e.target.value || null)}
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

  const deviceSessionActive = isBooted || capturing;

  const titleBarExtra =
    !deviceSessionActive && (selectedUdid || workspaceId) ? (
      <div className={chrome.titleBarTrailing}>
        {!isBooted && !capturing && selectedUdid && (
          <button
            className={chrome.titleBarButton}
            disabled={booting}
            title={booting ? "Booting..." : "Boot simulator"}
            type="button"
            onClick={handleBoot}
          >
            <BootIcon size={12} />
          </button>
        )}
      </div>
    ) : null;

  const actionButtons = (
    <>
      <div className={styles.floatingNavPrimary}>
        {capturing && (
          <button
            className={chrome.titleBarButton}
            title="Home (Cmd+Shift+H)"
            type="button"
            onClick={handleHomePress}
          >
            <HomeIcon size={12} />
          </button>
        )}
        {(isBooted || capturing) && selectedUdid && (
          <button
            className={`${chrome.titleBarButton} ${chrome.titleBarButtonDestructive}`}
            title="Disconnect simulator"
            type="button"
            onClick={handleDisconnect}
          >
            <DisconnectIcon size={12} />
          </button>
        )}
      </div>
      {workspaceId && <RunButton workspaceId={workspaceId} />}
    </>
  );

  // --- Placeholder ---

  const placeholderContent = isTv ? (
    <div className={styles.tvFrame}>
      <div className={styles.tvScreen}>
        <p className={chrome.phaseHint}>Boot a tvOS simulator to see it here</p>
      </div>
      <div className={styles.tvStand} />
    </div>
  ) : (
    <div className={styles.phoneFrame}>
      <div className={styles.phoneScreen}>
        <p className={chrome.phaseHint}>Boot a simulator to see it here</p>
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
        streamUrl: string | null;
      }) => (
        <div className={styles.tvBody}>
          <div className={styles.canvasContainer}>
            {streamUrl && (
              <img
                ref={imgRef}
                alt="Simulator"
                className={`${styles.canvas} ${styles.tvCanvas}`}
                draggable={false}
                src={streamUrl}
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
    <IosDeviceStreamView
      actionButtons={actionButtons}
      capturing={capturing}
      devicePicker={devicePicker}
      mjpegPort={mjpegPort}
      placeholder={placeholderContent}
      showFloatingActionBar={deviceSessionActive}
      titleBarExtra={titleBarExtra}
      toolsAvailable={iosToolsAvailable}
      toolsMissing={{
        title: "Xcode Command Line Tools Required",
        body: (
          <p className={chrome.phaseHint}>
            Run <code>xcode-select --install</code> in Terminal to install them.
          </p>
        ),
      }}
      renderStream={renderTvStream}
      streamAlt="Simulator"
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onTouch={handleTouch}
    >
      {children}
    </IosDeviceStreamView>
  );
}
