import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useState,
} from "react";
import { browserClaimId } from "@argus/remote-protocol";
import { useDeviceClaim } from "../../../hooks/useDeviceClaim";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import {
  type BrowserPresetConfig,
  resolvePreset,
} from "../../../lib/browserPresets";
import {
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
import { useRouteHostId } from "../../../lib/routeHooks";
import { subjectHostId } from "../../../lib/transport/hostRouting";
import { normalizeUrl } from "../../../lib/webBrowserViewUtils";
import { getSessionState } from "../../../stores/sessionStore";
import {
  getSimulatorState,
  useWebBrowserSimulatorState,
} from "../../../stores/simulatorStore";

interface BrowserNavEvent {
  canGoBack: boolean;
  canGoForward: boolean;
  sessionId: string;
  url: string;
}

export function useWebBrowserView(sessionId: string | null, isActive: boolean) {
  const {
    browserPreset,
    browserUrlBySession,
    setBrowserPreset,
    setBrowserUrl,
  } = useWebBrowserSimulatorState();

  const storeKey = sessionId ?? "__global__";
  const currentUrl = browserUrlBySession[storeKey] ?? "";

  const [inputUrl, setInputUrl] = useState(currentUrl);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [hasLoadedDefault, setHasLoadedDefault] = useState(false);
  const [customPresets, setCustomPresets] = useState<BrowserPresetConfig[]>([]);

  const preset = resolvePreset(browserPreset, customPresets);
  const { internalWidth, internalHeight } = preset;

  // Pick the default URL once per session, and push it to the backend.
  useEffect(() => {
    if (hasLoadedDefault || currentUrl) {
      return;
    }
    (async () => {
      let chosenUrl = "https://houwert.dev/argus";
      try {
        const session = getSessionState().sessions.find(
          (entry) => entry.id === sessionId,
        );
        if (session) {
          const config = await readArgusConfig(session.repo_root);
          if (config.browser_url) {
            chosenUrl = config.browser_url;
          }
          setCustomPresets(config.browser_presets ?? []);
        }
      } catch {
        // ignore read errors — fall back to the chosen default
      } finally {
        const latest = getSimulatorState().browserUrlBySession[storeKey] ?? "";
        if (!latest) {
          const url = normalizeUrl(chosenUrl);
          setBrowserUrl(storeKey, url);
          setInputUrl(url);
        }
        setHasLoadedDefault(true);
      }
    })();
  }, [sessionId, storeKey, currentUrl, hasLoadedDefault, setBrowserUrl]);

  useEffect(() => {
    setHasLoadedDefault(false);
  }, [sessionId]);

  useEffect(() => {
    setInputUrl(currentUrl);
  }, [currentUrl]);

  // One-shot: ensure the browser exists and load the default URL for this
  // session. Subsequent navigations are driven imperatively by the user
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
    if (payload?.sessionId !== storeKey) {
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

  // The browser runs on its session's host, and driving it arbitrates through
  // the same claim a simulator does — namespaced so a session id can't collide
  // with a UDID.
  const routeHostId = useRouteHostId();
  const hostId = subjectHostId({ sessionId: sessionId ?? "" }) ?? routeHostId;
  const claim = useDeviceClaim(browserClaimId(storeKey), hostId, isActive);
  const { reportInputError } = claim;

  const handleMouseEvent = useCallback(
    (
      type: "click" | "down" | "move" | "up",
      x: number,
      y: number,
      button?: "left" | "middle" | "right",
    ) => {
      browserMouseEvent(storeKey, type, x, y, button).catch(reportInputError);
    },
    [storeKey, reportInputError],
  );

  const handleKeyboardEvent = useCallback(
    (type: "down" | "press" | "up", key: string) => {
      browserKeyboardEvent(storeKey, type, key).catch(reportInputError);
    },
    [storeKey, reportInputError],
  );

  const handleWheelEvent = useCallback(
    (x: number, y: number, deltaX: number, deltaY: number) => {
      browserWheelEvent(storeKey, x, y, deltaX, deltaY).catch(reportInputError);
    },
    [storeKey, reportInputError],
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
    browserViewBack(storeKey).catch(reportInputError);
  }, [storeKey, reportInputError]);

  const handleForward = useCallback(() => {
    browserViewForward(storeKey).catch(reportInputError);
  }, [storeKey, reportInputError]);

  const handleReload = useCallback(() => {
    browserViewReload(storeKey).catch(reportInputError);
  }, [storeKey, reportInputError]);

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
    claim,
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
    preset,
    setInputUrl,
  };
}
