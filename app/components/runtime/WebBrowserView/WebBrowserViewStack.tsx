import { type ReactNode, useCallback } from "react";
import { Icons } from "@argus/peacock";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import {
  useRuntimeViewSimulatorState,
  useWebBrowserSimulatorState,
} from "../../../stores/simulatorStore";
import chrome from "../RuntimeChrome.module.css";
import { RuntimeTitleBar } from "../RuntimeTitleBar";
import { WebBrowserView } from "./WebBrowserView";
import styles from "./WebBrowserViewStack.module.css";

interface WebBrowserViewStackProps {
  activeSessionId: string | null;
  children?: ReactNode;
  titleBarToggles?: ReactNode;
}

/**
 * Renders one `<WebBrowserView>` per session that has been "mounted",
 * stacked with CSS visibility toggling. Only the active session's webview
 * is visible; the rest are hidden but stay mounted so they keep their page
 * state and the Electron guest process stays alive — and so Conductor stays
 * attached over CDP.
 *
 * Mounting is explicit: a session is only added to the pool when the user
 * clicks Boot or the backend asks us to mount it in response to an agent
 * issuing a conductor web command. This mirrors how iOS/Android require an
 * explicit boot before a device spins up, and avoids spawning a guest
 * process every time the user opens the simulator panel.
 */
export function WebBrowserViewStack({
  activeSessionId,
  children,
  titleBarToggles,
}: WebBrowserViewStackProps) {
  const { mountedSessionIds, ensureBrowserMounted } =
    useWebBrowserSimulatorState();
  const { platform } = useRuntimeViewSimulatorState();

  const activeKey = activeSessionId ?? "__global__";
  const activeMounted = Boolean(mountedSessionIds[activeKey]);

  // Backend push: an agent's conductor web command needs a webview for the
  // given session. Adding it to the mount set renders the webview, which
  // registers its webContents back with the browser service.
  useIpcEvent<{ sessionId: string }>("browser:ensure_mounted", (payload) => {
    if (payload?.sessionId) {
      ensureBrowserMounted(payload.sessionId);
    }
  });

  const handleBoot = useCallback(() => {
    ensureBrowserMounted(activeKey);
  }, [activeKey, ensureBrowserMounted]);

  const sessionIds = Object.keys(mountedSessionIds);

  return (
    <div className={styles.stack}>
      {sessionIds.map((wsId) => {
        const isActive = wsId === activeKey && platform === "web";

        return (
          <div
            key={wsId}
            aria-hidden={!isActive}
            className={isActive ? styles.layerVisible : styles.layerHidden}
          >
            <WebBrowserView
              isActive={isActive}
              sessionId={wsId}
              titleBarToggles={isActive ? titleBarToggles : undefined}
            >
              {isActive ? children : undefined}
            </WebBrowserView>
          </div>
        );
      })}
      {!activeMounted && (
        <div className={styles.layerVisible}>
          <div className={styles.placeholderShell}>
            <RuntimeTitleBar
              toggles={titleBarToggles}
              trailing={
                <div className={chrome.titleBarTrailing}>
                  <button
                    className={chrome.titleBarButton}
                    title="Boot browser"
                    type="button"
                    onClick={handleBoot}
                  >
                    <Icons.BootIcon size={12} />
                  </button>
                </div>
              }
            >
              {children}
            </RuntimeTitleBar>
            <div className={chrome.placeholder}>
              <p className={chrome.phaseHint}>Boot a browser to see it here</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
