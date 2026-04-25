import type { ReactNode } from "react";
import { useCallback, useEffect } from "react";
import { Icons, SegmentedControl } from "@argus/peacock";
import { InspectionPanel } from "../../../features/inspection/InspectionPanel";
import { NodeMetadataPanel } from "../../../features/inspection/NodeMetadataPanel";
import { useDragResize } from "../../../hooks/useDragResize";
import { openSimulatorPopout } from "../../../lib/ipc";
import { useActiveToolId } from "../../../stores/layoutStore";
import {
  useActiveDeviceKey,
  useRuntimeViewSimulatorState,
} from "../../../stores/simulatorStore";
import { RuntimeTargetPicker } from "../RuntimeTargetPicker/RuntimeTargetPicker";
import { WebBrowserViewStack } from "../WebBrowserView";
import { AndroidDeviceView } from "./AndroidDeviceView";
import { IosSimulatorView } from "./IosSimulatorView";
import styles from "./RuntimeView.module.css";

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

  useEffect(() => {
    if (activeToolId !== "simulator") {
      setRuntimeDialogOpen(false);
    }
  }, [activeToolId, setRuntimeDialogOpen]);

  const toggleRuntimeDialog = useCallback(() => {
    setRuntimeDialogOpen(!runtimeDialogOpen);
  }, [runtimeDialogOpen, setRuntimeDialogOpen]);

  const canPopout = !isPopout && platform === "ios" && !!activeDeviceKey;

  const { size: sidePanelWidth, onMouseDown: onSidePanelResize } =
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
    if (!activeDeviceKey) {
      return;
    }
    openSimulatorPopout(activeDeviceKey).catch(() => {
      // best-effort — the backend already logs failures
    });
  }, [activeDeviceKey]);

  const toggle = (
    <>
      <RuntimeTargetPicker sessionId={sessionId} />
      <SegmentedControl
        aria-label="Runtime mode"
        className={styles.modeSegment}
        value={runtimeMode}
        onChange={setRuntimeMode}
        options={[
          { label: "Simulate", value: "simulate" },
          { label: "Inspect", value: "inspect" },
        ]}
      />
    </>
  );

  const titleBarToggles = (
    <>
      {canPopout && (
        <button
          className={styles.runtimeToggleButton}
          title="Open simulator in floating window"
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
          </div>
        </div>
        {runtimeDialogOpen && runtimeMode === "inspect" && (
          <div className={styles.sidePanel} style={{ width: sidePanelWidth }}>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize side panel"
              className={styles.sidePanelResizer}
              onMouseDown={onSidePanelResize}
            />
            <NodeMetadataPanel />
          </div>
        )}
      </div>
    </>
  );
}
