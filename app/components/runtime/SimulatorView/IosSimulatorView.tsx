import type { DeviceOrientation } from "../../../lib/types";
import { useCallback, useEffect, useRef } from "react";
import { DeviceControlOverlay, Icons } from "@argus/peacock";
import { error } from "@logger";
import { useDeviceClaim } from "../../../hooks/useDeviceClaim";
import { useSimulatorDeviceState } from "../../../hooks/useSimulatorDeviceState";
import {
  bootSimulator,
  checkIosTools,
  disconnectSimulator,
  listSimulators,
  simulatorButton,
  simulatorKeyboard,
  simulatorSetFold,
  simulatorSetOrientation,
  simulatorTouch,
  startSimulatorCapture,
  stopSimulatorCapture,
} from "../../../lib/ipc";
import { KEYCODE_MAP, modifierFlagsFromEvent } from "../../../lib/keycodeMap";
import { useRouteHostId } from "../../../lib/routeHooks";
import {
  isTvOS,
  useIosSimulatorViewState,
} from "../../../stores/simulatorStore";
import chrome from "../RuntimeChrome.module.css";
import { AppleTVRemote } from "./AppleTVRemote";
import { IosDeviceStreamView } from "./IosDeviceStreamView";
import { RuntimeLinkButton } from "./RuntimeLinkButton";
import styles from "./RuntimeView.module.css";

interface IosSimulatorViewProps {
  children?: React.ReactNode;
  /** Hide the internal device `<select>` — the parent owns the target picker. */
  hideDevicePicker?: boolean;
  sessionId: string | null;
  titleBarToggles?: React.ReactNode;
}

export function IosSimulatorView({
  children,
  hideDevicePicker = false,
  sessionId,
  titleBarToggles,
}: IosSimulatorViewProps) {
  const {
    iosToolsAvailable,
    setIosToolsStatus,
    devices,
    selectedUdidBySession,
    capturing,
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
      setDisconnected(false);
    }

    prevSessionIdRef.current = storeKey;
  }, [storeKey, setDisconnected]);

  // Single owner of "the selected device changed": the runtime target picker
  // swaps the selection without going through the dropdown's own handler, and
  // leaving `capturing` set made the view render a dead stream for a device
  // nothing was capturing.
  useEffect(() => {
    const prevUdid = prevUdidRef.current;
    prevUdidRef.current = selectedUdid;
    if (prevUdid === null || prevUdid === selectedUdid) {
      return;
    }
    autoStartingRef.current = null;
    setCapturing(false);
    setMjpegPort(prevUdid, null);
    stopSimulatorCapture(prevUdid).catch(() => {});
  }, [selectedUdid, setCapturing, setMjpegPort]);

  // Release the capture ref on unmount. Without this, dismissing the
  // runtime panel leaks the ref and the bridge never tears down.
  useEffect(() => {
    return () => {
      const udid = prevUdidRef.current;
      if (udid) {
        stopSimulatorCapture(udid).catch(() => {});
      }
    };
  }, []);

  const startCapture = useCallback(
    async (udid: string) => {
      const port = await startSimulatorCapture(udid);
      setMjpegPort(udid, port);
      setCapturing(true);
    },
    [setMjpegPort, setCapturing],
  );

  // Auto-start capture for the selected simulator, booting it first when it is
  // shut down — picking a device is the request to see it. The guard is left
  // set on failure so a device that can't come up doesn't retry every render;
  // reselecting it clears the guard.
  useEffect(() => {
    if (
      capturing ||
      booting ||
      disconnected ||
      !selectedUdid ||
      autoStartingRef.current === selectedUdid
    ) {
      return;
    }
    const udid = selectedUdid;
    autoStartingRef.current = udid;
    (isBooted ? Promise.resolve() : bootSimulator(udid))
      .then(() => startCapture(udid))
      .then(() => {
        refreshDevices();
      })
      .catch((err) => {
        // Surface but don't wedge — user can retry via the boot button or by
        // reselecting the device.
        error("Auto-capture failed:", err);
      });
  }, [
    isBooted,
    capturing,
    booting,
    disconnected,
    selectedUdid,
    startCapture,
    refreshDevices,
  ]);

  // --- Title bar handlers ---

  const handleDeviceChange = useCallback(
    (udid: string | null) => {
      selectDevice(storeKey, udid);
    },
    [storeKey, selectDevice],
  );

  const handleBoot = useCallback(async () => {
    if (!selectedUdid || booting) {
      return;
    }
    setBooting(true);
    setDisconnected(false);
    try {
      await bootSimulator(selectedUdid);
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

  // Fold and orientation decide how the stream has to be presented, so the
  // view reads them rather than assuming portrait.
  const deviceState = useSimulatorDeviceState(selectedUdid, capturing);
  const rotation = deviceState?.display?.rotation ?? 0;
  const fold = deviceState?.fold ?? null;

  const handleRotate = useCallback(async () => {
    if (!selectedUdid) {
      return;
    }
    const order: DeviceOrientation[] = [
      "portrait",
      "landscapeLeft",
      "portraitUpsideDown",
      "landscapeRight",
    ];
    const current = deviceState?.orientation ?? "portrait";
    const next = order[(order.indexOf(current) + 1) % order.length]!;
    try {
      await simulatorSetOrientation(selectedUdid, next);
    } catch (err) {
      error("[Rotate] failed:", err);
    }
  }, [selectedUdid, deviceState?.orientation]);

  const handleFold = useCallback(async () => {
    if (!selectedUdid || !fold) {
      return;
    }
    try {
      await simulatorSetFold(
        selectedUdid,
        fold.pose === "open" ? "closed" : "open",
      );
    } catch (err) {
      error("[Fold] failed:", err);
    }
  }, [selectedUdid, fold]);

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

  // The device belongs to the host the view reads from; several may be
  // attached and each arbitrates its own devices.
  const hostId = useRouteHostId();
  const claim = useDeviceClaim(selectedUdid, hostId, capturing);
  const { reportInputError, takeControl } = claim;
  const handleTakeControl = useCallback(() => takeControl(), [takeControl]);

  const handleTouch = useCallback(
    (x: number, y: number, eventType: number) => {
      if (!selectedUdid) {
        return;
      }
      simulatorTouch(selectedUdid, x, y, eventType).catch((err) => {
        // A refusal means someone else took the device — show that rather
        // than a dead log line, in case it beat the claim broadcast here.
        if (!reportInputError(err)) {
          error("[Touch] failed:", err);
        }
      });
    },
    [selectedUdid, reportInputError],
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
      ).catch(reportInputError);
    },
    [selectedUdid, reportInputError],
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
      ).catch(reportInputError);
    },
    [selectedUdid, reportInputError],
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
      {capturing && (
        <button
          className={chrome.titleBarButton}
          title="Rotate device"
          type="button"
          onClick={handleRotate}
        >
          <Icons.RotateDeviceIcon size={12} />
        </button>
      )}
      {capturing && fold && (
        <button
          className={chrome.titleBarButton}
          title={fold.pose === "open" ? "Fold device" : "Unfold device"}
          type="button"
          onClick={handleFold}
        >
          <Icons.FoldIcon size={12} />
        </button>
      )}
      {capturing && selectedUdid && (
        <RuntimeLinkButton deviceKey={selectedUdid} sessionId={sessionId} />
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

  const renderTvStream =
    isTv && selectedUdid
      ? ({
          canvasRef,
          isReceiving,
          isConfigured,
          videoWidth,
          videoHeight,
        }: {
          canvasRef: React.RefObject<HTMLCanvasElement | null>;
          isConfigured: boolean;
          isReceiving: boolean;
          videoHeight: number;
          videoWidth: number;
        }) => (
          <div className={styles.tvBody}>
            <div className={styles.canvasContainer}>
              <canvas
                ref={canvasRef}
                className={`${styles.canvas} ${styles.tvCanvas}`}
                height={videoHeight || undefined}
                width={videoWidth || undefined}
              />
              <DeviceControlOverlay
                holderLabel={claim.holderLabel}
                onTakeControl={handleTakeControl}
              />
              {!isReceiving && (
                <div className={styles.connecting}>
                  <p>
                    {!isConfigured
                      ? "Connecting to device..."
                      : "Decoding first frame..."}
                  </p>
                </div>
              )}
            </div>
            <AppleTVRemote claim={claim} udid={selectedUdid} />
          </div>
        )
      : undefined;

  return (
    <IosDeviceStreamView
      actionButtons={actionButtons}
      capturing={capturing}
      claim={claim}
      devicePicker={hideDevicePicker ? null : devicePicker}
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
      rotation={rotation}
      udid={selectedUdid}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onTouch={handleTouch}
    >
      {children}
    </IosDeviceStreamView>
  );
}
