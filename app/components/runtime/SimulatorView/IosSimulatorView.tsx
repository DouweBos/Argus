import { useCallback, useEffect, useRef } from "react";
import { Icons } from "@argus/peacock";
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
import chrome from "../RuntimeChrome.module.css";
import { AppleTVRemote } from "./AppleTVRemote";
import { IosDeviceStreamView } from "./IosDeviceStreamView";
import styles from "./RuntimeView.module.css";

interface IosSimulatorViewProps {
  children?: React.ReactNode;
  sessionId: string | null;
  titleBarToggles?: React.ReactNode;
}

export function IosSimulatorView({
  children,
  sessionId,
  titleBarToggles,
}: IosSimulatorViewProps) {
  const {
    iosToolsAvailable,
    setIosToolsStatus,
    devices,
    selectedUdidBySession,
    capturing,
    mjpegPortByUdid,
    booting,
    disconnected,
    setDevices,
    selectDevice,
    setCapturing,
    setBooting,
    setMjpegPort,
    setDisconnected,
  } = useIosSimulatorViewState();

  const storeKey = sessionId ?? "__global__";
  const selectedUdid = selectedUdidBySession[storeKey] ?? null;
  const mjpegPort = selectedUdid
    ? (mjpegPortByUdid[selectedUdid] ?? null)
    : null;

  const selectedDevice = devices.find((d) => d.udid === selectedUdid);
  const isTv = isTvOS(selectedDevice);
  const isBooted = selectedDevice?.booted ?? false;
  const prevSessionIdRef = useRef<string | null>(null);
  // Guards against double auto-start while a previous startCapture() is
  // mid-flight — `capturing` only flips to true after the await resolves, so
  // rapid re-renders can otherwise enter the effect twice.
  const autoStartingRef = useRef<string | null>(null);

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

  // When session changes: release this view's capture reference for the
  // previously-selected UDID. Other holders (popouts, other sessions) keep
  // their streams alive because capture is ref-counted per UDID.
  const prevUdidRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      storeKey !== prevSessionIdRef.current &&
      prevSessionIdRef.current !== null
    ) {
      const prevUdid = prevUdidRef.current;
      if (prevUdid) {
        stopSimulatorCapture(prevUdid).catch(() => {});
      }
      setCapturing(false);
      setDisconnected(false);
    }

    prevSessionIdRef.current = storeKey;
  }, [storeKey, setCapturing, setDisconnected]);

  useEffect(() => {
    prevUdidRef.current = selectedUdid;
  }, [selectedUdid]);

  const startCapture = useCallback(
    async (udid: string) => {
      const port = await startSimulatorCapture(udid);
      setMjpegPort(udid, port);
      setCapturing(true);
    },
    [setMjpegPort, setCapturing],
  );

  // Auto-start capture when a simulator is booted (either because the user
  // just booted it, because it was booted externally before Argus opened, or
  // because a simctl poll observed the transition). Applies uniformly to iOS
  // and tvOS simulators — both render through this component.
  useEffect(() => {
    if (
      !isBooted ||
      capturing ||
      booting ||
      disconnected ||
      !selectedUdid ||
      autoStartingRef.current === selectedUdid
    ) {
      return;
    }
    autoStartingRef.current = selectedUdid;
    startCapture(selectedUdid)
      .catch((err) => {
        // Surface but don't wedge — user can retry via the boot button or by
        // reselecting the device.
        error("Auto-capture failed:", err);
      })
      .finally(() => {
        autoStartingRef.current = null;
      });
  }, [isBooted, capturing, booting, disconnected, selectedUdid, startCapture]);

  // --- Title bar handlers ---

  const handleDeviceChange = useCallback(
    async (udid: string | null) => {
      const prev = selectedUdid;
      if (capturing && prev) {
        try {
          await stopSimulatorCapture(prev);
        } catch {
          // Capture may already be stopped
        }

        setCapturing(false);
        setMjpegPort(prev, null);
      }

      selectDevice(storeKey, udid);
    },
    [
      capturing,
      selectedUdid,
      storeKey,
      selectDevice,
      setCapturing,
      setMjpegPort,
    ],
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
      setMjpegPort(selectedUdid, null);
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
    if (!selectedUdid) {
      return;
    }
    try {
      await simulatorButton(selectedUdid, "ios_home");
    } catch (err) {
      error("[Home] failed:", err);
    }
  }, [selectedUdid]);

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
      if (e.repeat || !selectedUdid) {
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
      simulatorKeyboard(
        selectedUdid,
        keyCode,
        modifierFlagsFromEvent(e.nativeEvent),
        true,
      );
    },
    [selectedUdid],
  );

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!selectedUdid) {
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
      simulatorKeyboard(
        selectedUdid,
        keyCode,
        modifierFlagsFromEvent(e.nativeEvent),
        false,
      );
    },
    [selectedUdid],
  );

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
    !deviceSessionActive && (selectedUdid || sessionId) ? (
      <div className={chrome.titleBarTrailing}>
        {!isBooted && !capturing && selectedUdid && (
          <button
            className={chrome.titleBarButton}
            disabled={booting}
            title={booting ? "Booting..." : "Boot simulator"}
            type="button"
            onClick={handleBoot}
          >
            <Icons.BootIcon size={12} />
          </button>
        )}
      </div>
    ) : null;

  const actionButtons = (
    <div className={styles.floatingNavPrimary}>
      {capturing && (
        <button
          className={chrome.titleBarButton}
          title="Home (Cmd+Shift+H)"
          type="button"
          onClick={handleHomePress}
        >
          <Icons.HomeIcon size={12} />
        </button>
      )}
      {(isBooted || capturing) && selectedUdid && (
        <button
          className={`${chrome.titleBarButton} ${chrome.titleBarButtonDestructive}`}
          title="Disconnect simulator"
          type="button"
          onClick={handleDisconnect}
        >
          <Icons.DisconnectIcon size={12} />
        </button>
      )}
    </div>
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

  const renderTvStream = isTv && selectedUdid
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
          <AppleTVRemote udid={selectedUdid} />
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
      titleBarToggles={titleBarToggles}
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
