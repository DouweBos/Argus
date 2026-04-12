import { type ReactNode, useEffect } from "react";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import {
  useRuntimeViewSimulatorState,
  useWebBrowserSimulatorState,
} from "../../../stores/simulatorStore";
import { WebBrowserView } from "./WebBrowserView";
import styles from "./WebBrowserViewStack.module.css";

interface WebBrowserViewStackProps {
  activeWorkspaceId: string | null;
  children?: ReactNode;
}

/**
 * Renders one `<WebBrowserView>` per workspace that has been "mounted",
 * stacked with CSS visibility toggling. Only the active workspace's webview
 * is visible; the rest are hidden but stay mounted so they keep their page
 * state and the Electron guest process stays alive — and so Conductor stays
 * attached over CDP.
 *
 * Mounting is lazy: a workspace is only added to the pool when it is first
 * needed, either because the user opens its Web tab or because the backend
 * asks us to mount it in response to an agent issuing a conductor web
 * command. This avoids spinning up a guest process for every workspace at
 * startup.
 *
 * This mirrors how the iOS simulator pool gives each agent its own device —
 * each workspace gets its own isolated browser session.
 */
export function WebBrowserViewStack({
  activeWorkspaceId,
  children,
}: WebBrowserViewStackProps) {
  const { mountedWorkspaceIds, ensureBrowserMounted } =
    useWebBrowserSimulatorState();
  const { platform } = useRuntimeViewSimulatorState();

  const activeKey = activeWorkspaceId ?? "__global__";

  // Auto-mount the active workspace so its Web tab renders immediately.
  useEffect(() => {
    ensureBrowserMounted(activeKey);
  }, [activeKey, ensureBrowserMounted]);

  // Backend push: an agent's conductor web command needs a webview for the
  // given workspace. Adding it to the mount set renders the webview, which
  // registers its webContents back with the browser service.
  useIpcEvent<{ sessionId: string }>("browser:ensure_mounted", (payload) => {
    if (payload?.sessionId) {
      ensureBrowserMounted(payload.sessionId);
    }
  });

  const workspaceIds = Object.keys(mountedWorkspaceIds);
  if (!workspaceIds.includes(activeKey)) {
    workspaceIds.push(activeKey);
  }

  return (
    <div className={styles.stack}>
      {workspaceIds.map((wsId) => {
        const isActive = wsId === activeKey && platform === "web";

        return (
          <div
            key={wsId}
            aria-hidden={!isActive}
            className={isActive ? styles.layerVisible : styles.layerHidden}
          >
            <WebBrowserView isActive={isActive} workspaceId={wsId}>
              {isActive ? children : undefined}
            </WebBrowserView>
          </div>
        );
      })}
    </div>
  );
}
