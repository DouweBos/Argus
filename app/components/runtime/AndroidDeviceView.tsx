import { useCallback, useEffect, useRef } from "react";
import { useSimulatorStore } from "../../stores/simulatorStore";
import { useAndroidVideoDecoder } from "../../hooks/useAndroidVideoDecoder";
import {
  checkAndroidTools,
  listAndroidDevices,
  bootAndroidEmulator,
  startAndroidCapture,
  stopAndroidCapture,
  disconnectAndroidDevice,
  androidTouch,
  androidKeyboard,
  androidButton,
} from "../../lib/ipc";
import {
  ANDROID_KEYCODE_MAP,
  androidMetaStateFromEvent,
} from "../../lib/androidKeycodeMap";
import { CanvasStreamBody } from "./CanvasStreamBody";
import { RunButton } from "./RunButton";
import { DisconnectIcon, BootIcon } from "../shared/Icons";
import styles from "./SimulatorView.module.css";

interface AndroidDeviceViewProps {
  children?: React.ReactNode;
  workspaceId: null | string;
}

export function AndroidDeviceView({
  children,
  workspaceId,
}: AndroidDeviceViewProps) {
  const {
    androidToolsAvailable,
    setAndroidToolsStatus,
    androidDevices,
    selectedAndroidByWorkspace,
    androidCapturing,
    androidBooting,
    androidDisconnected,
    setAndroidDevices,
    selectAndroidDevice,
    setAndroidCapturing,
    setAndroidBooting,
    setAndroidDisconnected,
  } = useSimulatorStore();

  const storeKey = workspaceId ?? "__global__";
  const selectedSerial = selectedAndroidByWorkspace[storeKey] ?? null;

  const selectedDevice = androidDevices.find(
    (d) => d.serial === selectedSerial,
  );
  const isOnline = selectedDevice?.online ?? false;
  const prevWorkspaceIdRef = useRef<null | string>(null);

  // WebCodecs decoder — active when capturing
  const { canvasRef, isReceiving, isConfigured, videoWidth, videoHeight } =
    useAndroidVideoDecoder(androidCapturing);

  // --- Tool availability check ---

  useEffect(() => {
    checkAndroidTools()
      .then(() => setAndroidToolsStatus(true, null))
      .catch((err) => setAndroidToolsStatus(false, String(err)));
  }, [setAndroidToolsStatus]);

  // --- Device polling ---

  const refreshDevices = useCallback(() => {
    listAndroidDevices()
      .then((devs) => {
        setAndroidDevices(devs);
        if (!androidToolsAvailable) setAndroidToolsStatus(true, null);
      })
      .catch(() => {
        checkAndroidTools()
          .then(() => setAndroidToolsStatus(true, null))
          .catch((err) => setAndroidToolsStatus(false, String(err)));
      });
  }, [setAndroidDevices, androidToolsAvailable, setAndroidToolsStatus]);

  useEffect(() => {
    if (androidToolsAvailable === false) return;
    refreshDevices();
    const interval = setInterval(refreshDevices, 5000);
    return () => clearInterval(interval);
  }, [refreshDevices, androidToolsAvailable]);

  // When workspace changes: stop current capture
  useEffect(() => {
    if (
      storeKey !== prevWorkspaceIdRef.current &&
      prevWorkspaceIdRef.current !== null
    ) {
      stopAndroidCapture()
        .then(() => {
          setAndroidCapturing(false);
          setAndroidDisconnected(false);
        })
        .catch(() => {
          setAndroidCapturing(false);
          setAndroidDisconnected(false);
        });
    }
    prevWorkspaceIdRef.current = storeKey;
  }, [storeKey, setAndroidCapturing, setAndroidDisconnected]);

  const startCapture = useCallback(
    async (serial: string) => {
      await startAndroidCapture(serial);
      setAndroidCapturing(true);
    },
    [setAndroidCapturing],
  );

  // Auto-start capture when device comes online
  useEffect(() => {
    if (
      isOnline &&
      !androidCapturing &&
      !androidBooting &&
      !androidDisconnected &&
      selectedSerial
    ) {
      startCapture(selectedSerial).catch((err) =>
        console.error("Auto-capture failed:", err),
      );
    }
  }, [
    isOnline,
    androidCapturing,
    androidBooting,
    androidDisconnected,
    selectedSerial,
    startCapture,
  ]);

  // --- Title bar handlers ---

  const handleDeviceChange = useCallback(
    async (serial: null | string) => {
      if (androidCapturing) {
        try {
          await stopAndroidCapture();
        } catch {
          // Capture may already be stopped
        }
        setAndroidCapturing(false);
      }
      selectAndroidDevice(storeKey, serial);
    },
    [androidCapturing, storeKey, selectAndroidDevice, setAndroidCapturing],
  );

  const handleBoot = useCallback(async () => {
    if (!selectedSerial || androidBooting) return;
    setAndroidBooting(true);
    setAndroidDisconnected(false);
    try {
      const isAvd = selectedDevice?.avdName && !selectedDevice.online;
      let serial = selectedSerial;
      if (isAvd && selectedDevice?.avdName) {
        serial = await bootAndroidEmulator(selectedDevice.avdName);
        selectAndroidDevice(storeKey, serial);
        await new Promise((r) => setTimeout(r, 2000));
      }
      await startCapture(serial);
      refreshDevices();
    } catch (err) {
      console.error("Boot/capture failed:", err);
    } finally {
      setAndroidBooting(false);
    }
  }, [
    selectedSerial,
    selectedDevice,
    androidBooting,
    storeKey,
    selectAndroidDevice,
    setAndroidBooting,
    setAndroidDisconnected,
    startCapture,
    refreshDevices,
  ]);

  const handleDisconnect = useCallback(async () => {
    if (!selectedSerial) return;
    try {
      await disconnectAndroidDevice(selectedSerial);
      setAndroidCapturing(false);
      setAndroidDisconnected(false);
      selectAndroidDevice(storeKey, null);
    } catch (err) {
      console.error("Disconnect failed:", err);
    }
  }, [
    selectedSerial,
    storeKey,
    selectAndroidDevice,
    setAndroidCapturing,
    setAndroidDisconnected,
  ]);

  const handleNavButton = useCallback((button: string) => {
    androidButton(button).catch((err) =>
      console.error(`[${button}] failed:`, err),
    );
  }, []);

  // --- Touch / keyboard callbacks ---

  const handleTouch = useCallback(
    (x: number, y: number, eventType: number) => {
      if (!selectedSerial) return;
      androidTouch(selectedSerial, x, y, eventType).catch((err) => {
        console.error("[Touch] failed:", err);
      });
    },
    [selectedSerial],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.repeat) return;
      if (e.metaKey && e.code !== "MetaLeft" && e.code !== "MetaRight") return;
      const keyCode = ANDROID_KEYCODE_MAP[e.code];
      if (keyCode === undefined) return;
      e.preventDefault();
      androidKeyboard(keyCode, androidMetaStateFromEvent(e.nativeEvent), true);
    },
    [],
  );

  const handleKeyUp = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey && e.code !== "MetaLeft" && e.code !== "MetaRight") return;
    const keyCode = ANDROID_KEYCODE_MAP[e.code];
    if (keyCode === undefined) return;
    e.preventDefault();
    androidKeyboard(keyCode, androidMetaStateFromEvent(e.nativeEvent), false);
  }, []);

  // --- Device picker ---

  const devicePicker = (
    <select
      className={styles.titleBarSelect}
      value={selectedSerial ?? ""}
      onChange={(e) => handleDeviceChange(e.target.value || null)}
      disabled={androidBooting}
    >
      <option value="">
        {androidDevices.length === 0 ? "No devices" : "Select device..."}
      </option>
      {androidDevices.map((d) => (
        <option key={d.serial} value={d.serial}>
          {d.name} ({d.type}){d.online ? " - Online" : " - Offline"}
        </option>
      ))}
    </select>
  );

  const actionButtons = (
    <div className={styles.titleBarActions}>
      {!androidCapturing && selectedSerial && (
        <button
          className={styles.titleBarButton}
          onClick={handleBoot}
          disabled={androidBooting}
          title={
            androidBooting
              ? "Booting..."
              : selectedDevice?.online
                ? "Connect"
                : "Boot"
          }
        >
          <BootIcon size={12} />
        </button>
      )}
      {androidCapturing && (
        <>
          <button
            className={styles.titleBarButton}
            onClick={() => handleNavButton("back")}
            title="Back"
          >
            <BackIcon size={12} />
          </button>
          <button
            className={styles.titleBarButton}
            onClick={() => handleNavButton("home")}
            title="Home"
          >
            <HomeCircleIcon size={12} />
          </button>
          <button
            className={styles.titleBarButton}
            onClick={() => handleNavButton("recents")}
            title="Recents"
          >
            <RecentsIcon size={12} />
          </button>
        </>
      )}
      {(isOnline || androidCapturing) && selectedSerial && (
        <button
          className={`${styles.titleBarButton} ${styles.titleBarButtonDestructive}`}
          onClick={handleDisconnect}
          title="Disconnect"
        >
          <DisconnectIcon size={12} />
        </button>
      )}
      {workspaceId && <RunButton workspaceId={workspaceId} />}
    </div>
  );

  // --- Render ---

  if (androidToolsAvailable === false) {
    return (
      <>
        <div className={styles.titleBar}>{children}</div>
        <div className={styles.placeholder}>
          <div className={styles.toolsMissingHint}>
            <p className={styles.toolsMissingTitle}>Android SDK Required</p>
            <p className={styles.phaseHint}>
              Install Android Studio and ensure ANDROID_HOME is set, or add adb
              to your PATH.
            </p>
          </div>
        </div>
      </>
    );
  }

  if (!androidCapturing) {
    return (
      <>
        <div className={styles.titleBar}>
          {children}
          {devicePicker}
          {actionButtons}
        </div>
        <div className={styles.placeholder}>
          <div className={styles.androidFrame}>
            <div className={styles.androidScreen}>
              <p className={styles.phaseHint}>
                Connect an Android device to see it here
              </p>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className={styles.titleBar}>
        {children}
        {devicePicker}
        {actionButtons}
      </div>
      <CanvasStreamBody
        canvasRef={canvasRef}
        videoWidth={videoWidth}
        videoHeight={videoHeight}
        isReceiving={isReceiving}
        isConfigured={isConfigured}
        onTouch={handleTouch}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
      />
    </>
  );
}

// --- Inline SVG icons for Android nav ---

function BackIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function HomeCircleIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

function RecentsIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  );
}
