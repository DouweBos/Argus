import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import {
  type BrowserPresetConfig,
  resolvePreset,
} from "../../../lib/browserPresets";
import {
  browserGetMjpegPort,
  browserKeyboardEvent,
  browserMouseEvent,
  browserUpdatePreset,
  browserViewBack,
  browserViewEnsure,
  browserViewForward,
  browserViewNavigate,
  browserViewReload,
  browserWheelEvent,
  readArgusConfig,
} from "../../../lib/ipc";
import { normalizeUrl } from "../../../lib/webBrowserViewUtils";
import {
  getSimulatorState,
  useWebBrowserSimulatorState,
} from "../../../stores/simulatorStore";
import { getWorkspaceState } from "../../../stores/workspaceStore";

interface BrowserNavEvent {
  canGoBack: boolean;
  canGoForward: boolean;
  url: string;
  workspaceId: string;
}

export function useWebBrowserView(
  workspaceId: string | null,
  _isActive: boolean,
) {
  const {
    browserPreset,
    browserUrlByWorkspace,
    setBrowserPreset,
    setBrowserUrl,
  } = useWebBrowserSimulatorState();

  const storeKey = workspaceId ?? "__global__";
  const currentUrl = browserUrlByWorkspace[storeKey] ?? "";

  const [inputUrl, setInputUrl] = useState(currentUrl);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [hasLoadedDefault, setHasLoadedDefault] = useState(false);
  const [customPresets, setCustomPresets] = useState<BrowserPresetConfig[]>([]);
  const [mjpegPort, setMjpegPort] = useState<number | null>(null);

  const preset = resolvePreset(browserPreset, customPresets);
  const { internalWidth, internalHeight } = preset;

  // Fetch MJPEG server port once on mount.
  useEffect(() => {
    browserGetMjpegPort()
      .then((port) => {
        if (port > 0) {
          setMjpegPort(port);
        }
      })
      .catch(() => {});
  }, []);

  // Pick the default URL once per workspace, and push it to the backend.
  useEffect(() => {
    if (hasLoadedDefault || currentUrl) {
      return;
    }
    (async () => {
      let chosenUrl = "https://houwert.dev";
      try {
        const workspace = getWorkspaceState().workspaces.find(
          (entry) => entry.id === workspaceId,
        );
        if (workspace) {
          const config = await readArgusConfig(workspace.repo_root);
          if (config.browser_url) {
            chosenUrl = config.browser_url;
          }
          setCustomPresets(config.browser_presets ?? []);
        }
      } catch {
        // ignore read errors — fall back to the chosen default
      } finally {
        const latest =
          getSimulatorState().browserUrlByWorkspace[storeKey] ?? "";
        if (!latest) {
          const url = normalizeUrl(chosenUrl);
          setBrowserUrl(storeKey, url);
          setInputUrl(url);
        }
        setHasLoadedDefault(true);
      }
    })();
  }, [workspaceId, storeKey, currentUrl, hasLoadedDefault, setBrowserUrl]);

  useEffect(() => {
    setHasLoadedDefault(false);
  }, [workspaceId]);

  useEffect(() => {
    setInputUrl(currentUrl);
  }, [currentUrl]);

  // One-shot: ensure the browser exists and load the default URL for this
  // workspace. Subsequent navigations are driven imperatively by the user
  // (URL bar, back/forward/reload) — not by watching `currentUrl`, which
  // diverges from the real page URL after in-page link clicks or redirects.
  const [hasInitialNavigated, setHasInitialNavigated] = useState(false);
  useEffect(() => {
    if (hasInitialNavigated || !currentUrl) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await browserViewEnsure(storeKey);
        if (!cancelled) {
          await browserViewNavigate(storeKey, currentUrl);
        }
      } catch {
        /* backend logs the error */
      } finally {
        if (!cancelled) {
          setHasInitialNavigated(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [storeKey, currentUrl, hasInitialNavigated]);

  useEffect(() => {
    setHasInitialNavigated(false);
  }, [storeKey]);

  // Receive nav push-events from the backend. Mirror the real page URL into
  // both the local input and the store so persisted state stays consistent.
  useIpcEvent<BrowserNavEvent>("browser_view:nav", (payload) => {
    if (payload?.workspaceId !== storeKey) {
      return;
    }
    if (payload.url) {
      setInputUrl(payload.url);
      setBrowserUrl(storeKey, payload.url);
    }
    setCanGoBack(payload.canGoBack);
    setCanGoForward(payload.canGoForward);
  });

  // ── Input handlers ───────────────────────────────────────────────────────

  const handleMouseEvent = useCallback(
    (
      type: "click" | "down" | "move" | "up",
      x: number,
      y: number,
      button?: "left" | "middle" | "right",
    ) => {
      browserMouseEvent(storeKey, type, x, y, button).catch(() => {});
    },
    [storeKey],
  );

  const handleKeyboardEvent = useCallback(
    (type: "down" | "press" | "up", key: string) => {
      browserKeyboardEvent(storeKey, type, key).catch(() => {});
    },
    [storeKey],
  );

  const handleWheelEvent = useCallback(
    (x: number, y: number, deltaX: number, deltaY: number) => {
      browserWheelEvent(storeKey, x, y, deltaX, deltaY).catch(() => {});
    },
    [storeKey],
  );

  // ── Navigation & preset handlers ─────────────────────────────────────────

  const handleUrlSubmit = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") {
        return;
      }
      const normalized = normalizeUrl(inputUrl);
      if (!normalized) {
        return;
      }
      setInputUrl(normalized);
      setBrowserUrl(storeKey, normalized);
      (async () => {
        try {
          await browserViewEnsure(storeKey);
          await browserViewNavigate(storeKey, normalized);
        } catch {
          /* backend logs the error */
        }
      })();
    },
    [inputUrl, storeKey, setBrowserUrl],
  );

  const handleBack = useCallback(() => {
    browserViewBack(storeKey).catch(() => {});
  }, [storeKey]);

  const handleForward = useCallback(() => {
    browserViewForward(storeKey).catch(() => {});
  }, [storeKey]);

  const handleReload = useCallback(() => {
    browserViewReload(storeKey).catch(() => {});
  }, [storeKey]);

  const handlePresetChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const newPresetId = event.target.value;
      setBrowserPreset(newPresetId);

      const newPreset = resolvePreset(newPresetId, customPresets);
      browserUpdatePreset(storeKey, {
        internalWidth: newPreset.internalWidth,
        internalHeight: newPreset.internalHeight,
        userAgent: newPreset.userAgent,
        screenPosition: newPreset.screenPosition,
      }).catch(() => {});
    },
    [storeKey, setBrowserPreset, customPresets],
  );

  return {
    browserPreset,
    canGoBack,
    canGoForward,
    currentUrl,
    customPresets,
    handleBack,
    handleForward,
    handleKeyboardEvent,
    handleMouseEvent,
    handlePresetChange,
    handleReload,
    handleUrlSubmit,
    handleWheelEvent,
    inputUrl,
    internalHeight,
    internalWidth,
    mjpegPort,
    preset,
    setInputUrl,
  };
}
