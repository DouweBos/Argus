import { useCallback, useEffect, useRef } from "react";
import { Icons } from "@argus/peacock";
import { error } from "@logger";
import {
  ANDROID_KEYCODE_MAP,
  androidMetaStateFromEvent,
} from "../../../lib/androidKeycodeMap";
import {
  androidButton,
  androidKeyboard,
  androidTouch,
  bootAndroidEmulator,
  checkAndroidTools,
  disconnectAndroidDevice,
  listAndroidDevices,
  startAndroidCapture,
  stopAndroidCapture,
} from "../../../lib/ipc";
import { useAndroidDeviceSimulatorState } from "../../../stores/simulatorStore";
import chrome from "../RuntimeChrome.module.css";
import { AndroidDeviceStreamView } from "./AndroidDeviceStreamView";
import styles from "./RuntimeView.module.css";

interface AndroidDeviceViewProps {
  children?: React.ReactNode;
  /** Hide the internal device `<select>` — the parent owns the target picker. */
  hideDevicePicker?: boolean;
  sessionId: string | null;
  titleBarToggles?: React.ReactNode;
}

export function AndroidDeviceView({
  children,
  hideDevicePicker = false,
  sessionId,
  titleBarToggles,
}: AndroidDeviceViewProps) {
  const {
    androidToolsAvailable,
    setAndroidToolsStatus,
    androidDevices,
    selectedAndroidBySession,
    androidCapturing,
    androidBooting,
    androidDisconnected,
    setAndroidDevices,
    selectAndroidDevice,
    setAndroidCapturing,
    setAndroidBooting,
    setAndroidDisconnected,
  } = useAndroidDeviceSimulatorState();

  const storeKey = sessionId ?? "__global__";
  const selectedSerial = selectedAndroidBySession[storeKey] ?? null;

  const selectedDevice = androidDevices.find(
    (d) => d.serial === selectedSerial,
  );
  const isOnline = selectedDevice?.online ?? false;
  const prevSessionIdRef = useRef<string | null>(null);

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
        if (!androidToolsAvailable) {
          setAndroidToolsStatus(true, null);
        }
      })
      .catch(() => {
        checkAndroidTools()
          .then(() => setAndroidToolsStatus(true, null))
          .catch((err) => setAndroidToolsStatus(false, String(err)));
      });
  }, [setAndroidDevices, androidToolsAvailable, setAndroidToolsStatus]);

  useEffect(() => {
    if (androidToolsAvailable === false) {
      return;
    }
    refreshDevices();
    const interval = setInterval(refreshDevices, 5000);

    return () => clearInterval(interval);
  }, [refreshDevices, androidToolsAvailable]);

  // When session changes: stop current capture
  useEffect(() => {
    if (
      storeKey !== prevSessionIdRef.current &&
      prevSessionIdRef.current !== null
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

    prevSessionIdRef.current = storeKey;
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
        error("Auto-capture failed:", err),
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
    async (serial: string | null) => {
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
    if (!selectedSerial || androidBooting) {
      return;
    }
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
      error("Boot/capture failed:", err);
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
    if (!selectedSerial) {
      return;
    }
    try {
      await disconnectAndroidDevice(selectedSerial);
      setAndroidCapturing(false);
      setAndroidDisconnected(false);
      selectAndroidDevice(storeKey, null);
    } catch (err) {
      error("Disconnect failed:", err);
    }
  }, [
    selectedSerial,
    storeKey,
    selectAndroidDevice,
    setAndroidCapturing,
    setAndroidDisconnected,
  ]);

  const handleNavButton = useCallback((button: string) => {
    androidButton(button).catch((err) => error(`[${button}] failed:`, err));
  }, []);

  // --- Touch / keyboard callbacks ---

  const handleTouch = useCallback(
    (x: number, y: number, eventType: number) => {
      if (!selectedSerial) {
        return;
      }
      androidTouch(selectedSerial, x, y, eventType).catch((err) => {
        error("[Touch] failed:", err);
      });
    },
    [selectedSerial],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.repeat) {
        return;
      }
      if (e.metaKey && e.code !== "MetaLeft" && e.code !== "MetaRight") {
        return;
      }
      const keyCode = ANDROID_KEYCODE_MAP[e.code];
      if (keyCode === undefined) {
        return;
      }
      e.preventDefault();
      androidKeyboard(keyCode, androidMetaStateFromEvent(e.nativeEvent), true);
    },
    [],
  );

  const handleKeyUp = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey && e.code !== "MetaLeft" && e.code !== "MetaRight") {
      return;
    }
    const keyCode = ANDROID_KEYCODE_MAP[e.code];
    if (keyCode === undefined) {
      return;
    }
    e.preventDefault();
    androidKeyboard(keyCode, androidMetaStateFromEvent(e.nativeEvent), false);
  }, []);

  // --- Device picker ---

  const devicePicker = (
    <select
      className={chrome.titleBarSelect}
      disabled={androidBooting}
      value={selectedSerial ?? ""}
      onChange={(e) => handleDeviceChange(e.target.value || null)}
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

  const deviceSessionActive = androidCapturing || isOnline;

  let bootActionTitle = "Boot";
  if (androidBooting) {
    bootActionTitle = "Booting...";
  } else if (selectedDevice?.online) {
    bootActionTitle = "Connect";
  }

  const titleBarExtra =
    !deviceSessionActive && (selectedSerial || sessionId) ? (
      <div className={chrome.titleBarTrailing}>
        {selectedSerial && (
          <button
            className={chrome.titleBarButton}
            disabled={androidBooting}
            title={bootActionTitle}
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
      {!androidCapturing && selectedSerial && deviceSessionActive && (
        <button
          className={chrome.titleBarButton}
          disabled={androidBooting}
          title={bootActionTitle}
          type="button"
          onClick={handleBoot}
        >
          <Icons.BootIcon size={12} />
        </button>
      )}
      {androidCapturing && (
        <>
          <button
            className={chrome.titleBarButton}
            title="Back"
            type="button"
            onClick={() => handleNavButton("back")}
          >
            <Icons.AndroidBackIcon size={12} />
          </button>
          <button
            className={chrome.titleBarButton}
            title="Home"
            type="button"
            onClick={() => handleNavButton("home")}
          >
            <Icons.AndroidHomeIcon size={12} />
          </button>
          <button
            className={chrome.titleBarButton}
            title="Recents"
            type="button"
            onClick={() => handleNavButton("recents")}
          >
            <Icons.AndroidRecentsIcon size={12} />
          </button>
        </>
      )}
      {(isOnline || androidCapturing) && selectedSerial && (
        <button
          className={`${chrome.titleBarButton} ${chrome.titleBarButtonDestructive}`}
          title="Disconnect"
          type="button"
          onClick={handleDisconnect}
        >
          <Icons.DisconnectIcon size={12} />
        </button>
      )}
    </div>
  );

  // --- Placeholder ---

  const placeholderContent = (
    <div className={styles.androidFrame}>
      <div className={styles.androidScreen}>
        <p className={chrome.phaseHint}>
          Connect an Android device to see it here
        </p>
      </div>
    </div>
  );

  return (
    <AndroidDeviceStreamView
      actionButtons={actionButtons}
      capturing={androidCapturing}
      devicePicker={hideDevicePicker ? null : devicePicker}
      placeholder={placeholderContent}
      showFloatingActionBar={deviceSessionActive}
      titleBarExtra={titleBarExtra}
      titleBarToggles={titleBarToggles}
      toolsAvailable={androidToolsAvailable}
      toolsMissing={{
        title: "Android SDK Required",
        body: (
          <p className={chrome.phaseHint}>
            Install Android Studio and ensure ANDROID_HOME is set, or add adb to
            your PATH.
          </p>
        ),
      }}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onTouch={handleTouch}
    >
      {children}
    </AndroidDeviceStreamView>
  );
}
