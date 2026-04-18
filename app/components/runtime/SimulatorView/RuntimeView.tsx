import type { ReactNode } from "react";
import { useCallback, useEffect } from "react";
import { Icons, PlatformChip } from "@argus/peacock";
import { useActiveToolId } from "../../../stores/layoutStore";
import { useRuntimeViewSimulatorState } from "../../../stores/simulatorStore";
import { WebBrowserViewStack } from "../WebBrowserView";
import { AndroidDeviceView } from "./AndroidDeviceView";
import { IosSimulatorView } from "./IosSimulatorView";
import styles from "./RuntimeView.module.css";

interface RuntimeViewProps {
  workspaceId: string | null;
}

/**
 * Renders iOS / Android / Web runtime with a shared platform toggle. The
 * whole surface can be shown embedded in the tool panel or in a modal dialog
 * (see `runtimeDialogOpen` in the simulator store).
 */
export function RuntimeView({ workspaceId }: RuntimeViewProps) {
  const { platform, setPlatform, runtimeDialogOpen, setRuntimeDialogOpen } =
    useRuntimeViewSimulatorState();
  const activeToolId = useActiveToolId();

  useEffect(() => {
    if (activeToolId !== "simulator") {
      setRuntimeDialogOpen(false);
    }
  }, [activeToolId, setRuntimeDialogOpen]);

  const toggleRuntimeDialog = useCallback(() => {
    setRuntimeDialogOpen(!runtimeDialogOpen);
  }, [runtimeDialogOpen, setRuntimeDialogOpen]);

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

  let nativeSimulator: ReactNode = null;
  if (platform === "ios") {
    nativeSimulator = (
      <IosSimulatorView workspaceId={workspaceId}>{toggle}</IosSimulatorView>
    );
  } else if (platform === "android") {
    nativeSimulator = (
      <AndroidDeviceView workspaceId={workspaceId}>{toggle}</AndroidDeviceView>
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
      >
        <div className={styles.runtimeRoot}>
          <button
            className={styles.runtimeExpandToggle}
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
              <WebBrowserViewStack activeWorkspaceId={workspaceId}>
                {toggle}
              </WebBrowserViewStack>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
