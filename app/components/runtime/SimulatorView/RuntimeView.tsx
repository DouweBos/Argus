import type { ReactNode } from "react";
import { useCallback, useEffect } from "react";
import { Icons, SegmentedControl } from "@argus/peacock";
import { useDragResize } from "@argus/peacock";
import { InspectionPanel } from "../../../features/inspection/InspectionPanel";
import { NodeMetadataPanel } from "../../../features/inspection/NodeMetadataPanel";
import {
  useVideoInputDevices,
  videoInputLabel,
} from "../../../hooks/useVideoInputDevices";
import { openDevicePopout } from "../../../lib/ipc";
import { useActiveToolId } from "../../../stores/layoutStore";
import {
  useActiveDeviceKey,
  useRuntimeViewSimulatorState,
} from "../../../stores/simulatorStore";
import { useEffectiveToolEnabled } from "../../../tools/store";
import { DesignCompare } from "../DesignCompare/DesignCompare";
import { FileIssueButton } from "../FileIssueDialog/FileIssueButton";
import { RuntimeTargetPicker } from "../RuntimeTargetPicker/RuntimeTargetPicker";
import { WebBrowserViewStack } from "../WebBrowserView";
import { AndroidDeviceView } from "./AndroidDeviceView";
import { IosSimulatorView } from "./IosSimulatorView";
import styles from "./RuntimeView.module.css";
import { VideoInputView } from "./VideoInputView";
import { useRuntimeModes } from "./useRuntimeModes";

interface RuntimeViewProps {
  sessionId: string | null;
  /**
   * When "popout", hide the expand/popout toggles and skip the unmount
   * cleanup that closes popout windows — the popout itself is already the
   * floating window.
   */
  variant?: "embedded" | "popout";
}

/**
 * Renders iOS / Android / Web runtime with a shared platform toggle. The
 * whole surface can be shown embedded in the tool panel or in a modal dialog
 * (see `runtimeDialogOpen` in the simulator store).
 */
const SIDE_PANEL_KEY = "argus:runtime:sidePanelWidth";
const SIDE_PANEL_DEFAULT = 300;
const SIDE_PANEL_MIN = 240;
const SIDE_PANEL_MAX = 720;

function loadSidePanelWidth(): number {
  try {
    const raw = localStorage.getItem(SIDE_PANEL_KEY);
    const n = raw ? Number.parseFloat(raw) : NaN;
    if (Number.isFinite(n)) {
      return Math.min(SIDE_PANEL_MAX, Math.max(SIDE_PANEL_MIN, n));
    }
  } catch {
    // ignore
  }

  return SIDE_PANEL_DEFAULT;
}

export function RuntimeView({
  sessionId,
  variant = "embedded",
}: RuntimeViewProps) {
  const isPopout = variant === "popout";
  const {
    platform,
    runtimeDialogOpen,
    setRuntimeDialogOpen,
    runtimeMode,
    setRuntimeMode,
  } = useRuntimeViewSimulatorState();
  const activeToolId = useActiveToolId("right");
  const activeDeviceKey = useActiveDeviceKey(sessionId, platform);
  const toolInspectorEnabled = useEffectiveToolEnabled("device-inspector");
  // Native inspection is Apple-only (iOS/iPadOS/tvOS all run as iOS sims here).
  const inspectorEnabled = toolInspectorEnabled && platform === "ios";

  const { designEnabled, designPlatform, designRefs, runtimeModeOptions } =
    useRuntimeModes({
      inspectorEnabled,
      platform,
      runtimeMode,
      sessionId,
      setRuntimeMode,
    });

  useEffect(() => {
    if (activeToolId !== "simulator") {
      setRuntimeDialogOpen(false);
    }
  }, [activeToolId, setRuntimeDialogOpen]);

  const toggleRuntimeDialog = useCallback(() => {
    setRuntimeDialogOpen(!runtimeDialogOpen);
  }, [runtimeDialogOpen, setRuntimeDialogOpen]);

  // Web runs in an embedded WebContentsView owned by this window — it can't be
  // handed to another one, so every platform but Web can be detached.
  const videoInputs = useVideoInputDevices();
  const canPopout = !isPopout && platform !== "web" && !!activeDeviceKey;

  const { size: sidePanelWidth, onPointerDown: onSidePanelResize } =
    useDragResize({
      axis: "horizontal",
      initialSize: loadSidePanelWidth(),
      min: SIDE_PANEL_MIN,
      max: SIDE_PANEL_MAX,
      invert: true,
    });
  useEffect(() => {
    try {
      localStorage.setItem(SIDE_PANEL_KEY, String(sidePanelWidth));
    } catch {
      // ignore storage failures
    }
  }, [sidePanelWidth]);

  const handlePopout = useCallback(() => {
    if (!activeDeviceKey || platform === "web") {
      return;
    }
    // Video inputs only exist in the renderer, so the label travels with the
    // request — the backend has no way to resolve it.
    const index = videoInputs.findIndex((d) => d.deviceId === activeDeviceKey);
    const name =
      platform === "video" && index >= 0
        ? videoInputLabel(videoInputs[index], index)
        : undefined;

    openDevicePopout({ platform, deviceKey: activeDeviceKey, name }).catch(
      () => {
        // best-effort — the backend already logs failures
      },
    );
  }, [activeDeviceKey, platform, videoInputs]);

  const toggle = (
    <>
      <RuntimeTargetPicker sessionId={sessionId} />
      {runtimeModeOptions.length > 1 && (
        <SegmentedControl
          aria-label="Runtime mode"
          className={styles.modeSegment}
          value={runtimeMode}
          onChange={setRuntimeMode}
          options={runtimeModeOptions}
        />
      )}
    </>
  );

  const titleBarToggles = (
    <>
      {designPlatform && activeDeviceKey && sessionId && (
        <FileIssueButton
          className={styles.runtimeToggleButton}
          deviceKey={activeDeviceKey}
          platform={designPlatform}
          sessionId={sessionId}
        />
      )}
      {canPopout && (
        <button
          className={styles.runtimeToggleButton}
          title="Open in floating window"
          type="button"
          onClick={handlePopout}
        >
          <Icons.PopoutIcon size={11} />
        </button>
      )}
      {!isPopout && (
        <button
          className={styles.runtimeToggleButton}
          title={runtimeDialogOpen ? "Dock in sidebar" : "Open in dialog"}
          type="button"
          onClick={toggleRuntimeDialog}
        >
          {runtimeDialogOpen ? (
            <Icons.ShrinkIcon size={11} />
          ) : (
            <Icons.EnlargeIcon size={11} />
          )}
        </button>
      )}
    </>
  );

  let nativeSimulator: ReactNode = null;
  if (platform === "ios") {
    nativeSimulator = (
      <IosSimulatorView
        sessionId={sessionId}
        titleBarToggles={titleBarToggles}
        hideDevicePicker
      >
        {toggle}
      </IosSimulatorView>
    );
  } else if (platform === "android") {
    nativeSimulator = (
      <AndroidDeviceView
        sessionId={sessionId}
        titleBarToggles={titleBarToggles}
        hideDevicePicker
      >
        {toggle}
      </AndroidDeviceView>
    );
  } else if (platform === "video") {
    nativeSimulator = (
      <VideoInputView sessionId={sessionId} titleBarToggles={titleBarToggles}>
        {toggle}
      </VideoInputView>
    );
  }

  // Always render in the same DOM position. The enlarged "dialog" state is
  // achieved purely via CSS (position:fixed) — no createPortal. This keeps
  // <webview> elements in a stable DOM tree so the Electron guest process
  // is never torn down when toggling between embedded and enlarged views.
  return (
    <>
      {runtimeDialogOpen && (
        <div
          className={styles.runtimeBackdrop}
          onClick={() => setRuntimeDialogOpen(false)}
        />
      )}
      <div
        className={
          runtimeDialogOpen ? styles.runtimeDialog : styles.runtimeEmbeddedShell
        }
        style={
          runtimeDialogOpen
            ? { display: "flex", flexDirection: "row", gap: 8 }
            : undefined
        }
      >
        <div className={styles.runtimeRoot}>
          <div className={styles.layout}>
            {nativeSimulator !== null && (
              <div className={styles.nativeSimulatorLayer}>
                {nativeSimulator}
              </div>
            )}
            <div
              aria-hidden={platform !== "web"}
              className={
                platform === "web"
                  ? `${styles.webPersistentShell} ${styles.webPersistentShellVisible}`
                  : `${styles.webPersistentShell} ${styles.webPersistentShellHidden}`
              }
            >
              <WebBrowserViewStack
                activeSessionId={sessionId}
                titleBarToggles={titleBarToggles}
              >
                {toggle}
              </WebBrowserViewStack>
            </div>
            {inspectorEnabled && (
              <div
                className={
                  runtimeMode === "inspect"
                    ? styles.inspectionLayer
                    : styles.inspectionLayerHidden
                }
                aria-hidden={runtimeMode !== "inspect"}
              >
                <InspectionPanel
                  deviceKey={activeDeviceKey}
                  showSidebar={runtimeDialogOpen || isPopout}
                />
              </div>
            )}
            {designEnabled &&
              designPlatform &&
              designRefs &&
              runtimeMode === "design" && (
                <div className={styles.inspectionLayer}>
                  <DesignCompare
                    deviceKey={activeDeviceKey}
                    platform={designPlatform}
                    refs={designRefs}
                    sessionId={sessionId}
                  />
                </div>
              )}
          </div>
        </div>
        {inspectorEnabled && runtimeDialogOpen && runtimeMode === "inspect" && (
          <div className={styles.sidePanel} style={{ width: sidePanelWidth }}>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize side panel"
              className={styles.sidePanelResizer}
              onPointerDown={onSidePanelResize}
            />
            <NodeMetadataPanel deviceKey={activeDeviceKey} />
          </div>
        )}
      </div>
    </>
  );
}
