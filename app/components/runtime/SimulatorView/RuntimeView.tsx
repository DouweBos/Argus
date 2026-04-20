import type { ReactNode } from "react";
import { useCallback, useEffect } from "react";
import { Icons, PlatformChip } from "@argus/peacock";
import { openSimulatorPopout } from "../../../lib/ipc";
import { useActiveToolId } from "../../../stores/layoutStore";
import {
  useActiveDeviceKey,
  useRuntimeViewSimulatorState,
} from "../../../stores/simulatorStore";
import { ConductorLogPanel } from "../../devices/DeviceDialog/ConductorLogPanel";
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
export function RuntimeView({
  sessionId,
  variant = "embedded",
}: RuntimeViewProps) {
  const isPopout = variant === "popout";
  const { platform, setPlatform, runtimeDialogOpen, setRuntimeDialogOpen } =
    useRuntimeViewSimulatorState();
  const activeToolId = useActiveToolId();
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

  const handlePopout = useCallback(() => {
    if (!activeDeviceKey) {
      return;
    }
    openSimulatorPopout(activeDeviceKey).catch(() => {
      // best-effort — the backend already logs failures
    });
  }, [activeDeviceKey]);

  const toggle = (
    <div className={styles.platformToggle}>
      <PlatformChip
        active={platform === "ios"}
        platform="ios"
        onClick={() => setPlatform("ios")}
      />
      <PlatformChip
        active={platform === "android"}
        platform="android"
        onClick={() => setPlatform("android")}
      />
      <PlatformChip
        active={platform === "web"}
        platform="web"
        onClick={() => setPlatform("web")}
      />
    </div>
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
      <IosSimulatorView sessionId={sessionId} titleBarToggles={titleBarToggles}>
        {toggle}
      </IosSimulatorView>
    );
  } else if (platform === "android") {
    nativeSimulator = (
      <AndroidDeviceView
        sessionId={sessionId}
        titleBarToggles={titleBarToggles}
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
          </div>
        </div>
        {runtimeDialogOpen && activeDeviceKey && (
          <div
            style={{
              width: 380,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            <ConductorLogPanel deviceKey={activeDeviceKey} />
          </div>
        )}
      </div>
    </>
  );
}
