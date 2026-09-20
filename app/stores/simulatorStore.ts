import type { AndroidDevice, SimulatorDevice } from "../lib/types";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

/** Check if a device is a tvOS (Apple TV) simulator. */
export function isTvOS(device: SimulatorDevice | undefined): boolean {
  return device?.runtime.startsWith("tvOS") ?? false;
}

const STORAGE_KEY = "argus:simulatorBySession";
const ANDROID_STORAGE_KEY = "argus:androidBySession";
const VIDEO_STORAGE_KEY = "argus:videoBySession";
const PLATFORM_STORAGE_KEY = "argus:platform";
const BROWSER_PRESET_STORAGE_KEY = "argus:browserPreset";

function loadSelectedBySession(key: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === "string" && typeof v === "string") {
        result[k] = v;
      }
    }

    return result;
  } catch {
    return {};
  }
}

function saveSelectedBySession(
  key: string,
  map: Record<string, string | null>,
) {
  const toSave: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    if (v) {
      toSave[k] = v;
    }
  }

  localStorage.setItem(key, JSON.stringify(toSave));
}

function loadPlatform(): Platform {
  try {
    const raw = localStorage.getItem(PLATFORM_STORAGE_KEY);
    if (raw === "android") {
      return "android";
    }
    if (raw === "web") {
      return "web";
    }
    if (raw === "video") {
      return "video";
    }
  } catch {
    // ignore
  }

  return "ios";
}

function loadBrowserPreset(): string {
  try {
    const raw = localStorage.getItem(BROWSER_PRESET_STORAGE_KEY);
    if (raw) {
      return raw;
    }
  } catch {
    // ignore
  }

  return "desktop";
}

export type Platform = "android" | "ios" | "video" | "web";
export type RuntimeMode = "inspect" | "simulate";

interface SimulatorStoreData {
  androidBooting: boolean;
  androidCapturing: boolean;
  androidDevices: AndroidDevice[];
  androidDisconnected: boolean;
  androidToolsAvailable: boolean | null;
  androidToolsError: string | null;
  booting: boolean;
  browserPreset: string;
  browserUrlBySession: Record<string, string>;
  capturing: boolean;
  devices: SimulatorDevice[];
  disconnected: boolean;
  iosToolsAvailable: boolean | null;
  iosToolsError: string | null;
  /**
   * Active MJPEG stream ports keyed by simulator UDID. Each captured
   * simulator runs its own bridge process with its own port, so multiple
   * popouts can stream in parallel.
   */
  mjpegPortByUdid: Record<string, number>;
  /**
   * Set of session IDs whose web `<webview>` is mounted in the stack.
   * A session is added to this set the first time it is needed — either
   * when the user opens its Web runtime tab, or when an agent issues a
   * Conductor web command and the backend asks us to mount it via the
   * `browser:ensure_mounted` event. Once mounted we keep the webview alive
   * for the rest of the session so Conductor stays attached.
   */
  mountedSessionIds: Record<string, true>;
  platform: Platform;
  /** Simulator runtime (iOS / Android / Web) shown in the tool panel or in a fullscreen-style dialog */
  runtimeDialogOpen: boolean;
  /** Whether the runtime view shows the live simulator or the inspection panel. */
  runtimeMode: RuntimeMode;
  selectedAndroidBySession: Record<string, string | null>;
  selectedUdidBySession: Record<string, string | null>;
  /** Selected video-input (capture card / camera) `deviceId` per session. */
  selectedVideoBySession: Record<string, string | null>;
}

const simulatorStore = create<SimulatorStoreData>(() => ({
  platform: loadPlatform(),
  iosToolsAvailable: null,
  iosToolsError: null,
  devices: [],
  selectedUdidBySession: loadSelectedBySession(STORAGE_KEY),
  capturing: false,
  booting: false,
  disconnected: false,
  mjpegPortByUdid: {},
  androidToolsAvailable: null,
  androidToolsError: null,
  androidDevices: [],
  selectedAndroidBySession: loadSelectedBySession(ANDROID_STORAGE_KEY),
  selectedVideoBySession: loadSelectedBySession(VIDEO_STORAGE_KEY),
  androidCapturing: false,
  androidBooting: false,
  androidDisconnected: false,
  browserPreset: loadBrowserPreset(),
  browserUrlBySession: {},
  mountedSessionIds: {},
  runtimeDialogOpen: false,
  runtimeMode: "simulate",
}));

const useSimulatorStore = simulatorStore;

export const setPlatform = (platform: Platform) => {
  localStorage.setItem(PLATFORM_STORAGE_KEY, platform);
  simulatorStore.setState({ platform });
};

export const setRuntimeMode = (mode: RuntimeMode) => {
  simulatorStore.setState({ runtimeMode: mode });
};

export const setIosToolsStatus = (available: boolean, error: string | null) => {
  simulatorStore.setState({
    iosToolsAvailable: available,
    iosToolsError: error,
  });
};

export const setDevices = (devices: SimulatorDevice[]) => {
  simulatorStore.setState((state) => {
    const deviceUdids = new Set(devices.map((d) => d.udid));
    let changed = false;
    const next: Record<string, string | null> = {};
    for (const [wsId, udid] of Object.entries(state.selectedUdidBySession)) {
      if (udid && !deviceUdids.has(udid)) {
        next[wsId] = null;
        changed = true;
      } else {
        next[wsId] = udid;
      }
    }

    if (changed) {
      saveSelectedBySession(STORAGE_KEY, next);
    }

    return { devices, ...(changed ? { selectedUdidBySession: next } : {}) };
  });
};

export const selectDevice = (sessionId: string, udid: string | null) => {
  simulatorStore.setState((state) => {
    const next = { ...state.selectedUdidBySession, [sessionId]: udid };
    saveSelectedBySession(STORAGE_KEY, next);

    return { selectedUdidBySession: next, disconnected: false };
  });
};

export const setCapturing = (capturing: boolean) => {
  simulatorStore.setState({ capturing });
};

export const setBooting = (booting: boolean) => {
  simulatorStore.setState({ booting });
};

export const setDisconnected = (disconnected: boolean) => {
  simulatorStore.setState({ disconnected });
};

export const setMjpegPort = (udid: string, port: number | null) => {
  simulatorStore.setState((state) => {
    if (port == null) {
      if (!(udid in state.mjpegPortByUdid)) {
        return state;
      }
      const next: Record<string, number> = {};
      for (const [k, v] of Object.entries(state.mjpegPortByUdid)) {
        if (k !== udid) {
          next[k] = v;
        }
      }

      return { mjpegPortByUdid: next };
    }

    return {
      mjpegPortByUdid: { ...state.mjpegPortByUdid, [udid]: port },
    };
  });
};

export const setAndroidToolsStatus = (
  available: boolean,
  error: string | null,
) => {
  simulatorStore.setState({
    androidToolsAvailable: available,
    androidToolsError: error,
  });
};

export const setAndroidDevices = (devices: AndroidDevice[]) => {
  simulatorStore.setState((state) => {
    const serials = new Set(devices.map((d) => d.serial));
    let changed = false;
    const next: Record<string, string | null> = {};
    for (const [wsId, serial] of Object.entries(
      state.selectedAndroidBySession,
    )) {
      if (serial && !serials.has(serial)) {
        next[wsId] = null;
        changed = true;
      } else {
        next[wsId] = serial;
      }
    }

    if (changed) {
      saveSelectedBySession(ANDROID_STORAGE_KEY, next);
    }

    return {
      androidDevices: devices,
      ...(changed ? { selectedAndroidBySession: next } : {}),
    };
  });
};

export const selectAndroidDevice = (
  sessionId: string,
  serial: string | null,
) => {
  simulatorStore.setState((state) => {
    const next = {
      ...state.selectedAndroidBySession,
      [sessionId]: serial,
    };
    saveSelectedBySession(ANDROID_STORAGE_KEY, next);

    return { selectedAndroidBySession: next, androidDisconnected: false };
  });
};

export const selectVideoInput = (
  sessionId: string,
  deviceId: string | null,
) => {
  simulatorStore.setState((state) => {
    const next = {
      ...state.selectedVideoBySession,
      [sessionId]: deviceId,
    };
    saveSelectedBySession(VIDEO_STORAGE_KEY, next);

    return { selectedVideoBySession: next };
  });
};

export const setAndroidCapturing = (capturing: boolean) => {
  simulatorStore.setState({ androidCapturing: capturing });
};

export const setAndroidBooting = (booting: boolean) => {
  simulatorStore.setState({ androidBooting: booting });
};

export const setAndroidDisconnected = (disconnected: boolean) => {
  simulatorStore.setState({ androidDisconnected: disconnected });
};

export const setBrowserPreset = (preset: string) => {
  localStorage.setItem(BROWSER_PRESET_STORAGE_KEY, preset);
  simulatorStore.setState({ browserPreset: preset });
};

export const setRuntimeDialogOpen = (open: boolean) => {
  simulatorStore.setState({ runtimeDialogOpen: open });
};

export const setBrowserUrl = (sessionId: string, url: string) => {
  simulatorStore.setState((state) => ({
    browserUrlBySession: {
      ...state.browserUrlBySession,
      [sessionId]: url,
    },
  }));
};

export const ensureBrowserMounted = (sessionId: string) => {
  simulatorStore.setState((state) => {
    if (state.mountedSessionIds[sessionId]) {
      return state;
    }

    return {
      mountedSessionIds: {
        ...state.mountedSessionIds,
        [sessionId]: true,
      },
    };
  });
};

export function useAndroidDeviceSimulatorState() {
  const data = useSimulatorStore(
    useShallow((s) => ({
      androidToolsAvailable: s.androidToolsAvailable,
      androidDevices: s.androidDevices,
      selectedAndroidBySession: s.selectedAndroidBySession,
      androidCapturing: s.androidCapturing,
      androidBooting: s.androidBooting,
      androidDisconnected: s.androidDisconnected,
    })),
  );

  return {
    ...data,
    setAndroidToolsStatus,
    setAndroidDevices,
    selectAndroidDevice,
    setAndroidCapturing,
    setAndroidBooting,
    setAndroidDisconnected,
  };
}

export function useIosSimulatorViewState() {
  const data = useSimulatorStore(
    useShallow((s) => ({
      iosToolsAvailable: s.iosToolsAvailable,
      devices: s.devices,
      selectedUdidBySession: s.selectedUdidBySession,
      capturing: s.capturing,
      mjpegPortByUdid: s.mjpegPortByUdid,
      booting: s.booting,
      disconnected: s.disconnected,
    })),
  );

  return {
    ...data,
    setIosToolsStatus,
    setDevices,
    selectDevice,
    setCapturing,
    setBooting,
    setMjpegPort,
    setDisconnected,
  };
}

export function useSimulatorControlsState() {
  const data = useSimulatorStore(
    useShallow((s) => ({
      devices: s.devices,
      selectedUdidBySession: s.selectedUdidBySession,
      capturing: s.capturing,
      booting: s.booting,
      disconnected: s.disconnected,
    })),
  );

  return {
    ...data,
    setDevices,
    selectDevice,
    setCapturing,
    setBooting,
    setDisconnected,
    setMjpegPort,
  };
}

/**
 * Returns the combined state needed by the RuntimeTargetPicker — active
 * platform, both device lists, and the session's current iOS/Android pick.
 * Memoised with `useShallow` so the picker only re-renders on real changes.
 */
export function useRuntimeTargetState(sessionId: string | null) {
  return useSimulatorStore(
    useShallow((s) => ({
      platform: s.platform,
      devices: s.devices,
      androidDevices: s.androidDevices,
      iosUdid: s.selectedUdidBySession[sessionId ?? "__global__"] ?? null,
      androidSerial:
        s.selectedAndroidBySession[sessionId ?? "__global__"] ?? null,
      videoDeviceId:
        s.selectedVideoBySession[sessionId ?? "__global__"] ?? null,
    })),
  );
}

/** The selected video-input `deviceId` for a session (capture card viewer). */
export function useSelectedVideoDeviceId(sessionId: string | null) {
  return useSimulatorStore(
    (s) => s.selectedVideoBySession[sessionId ?? "__global__"] ?? null,
  );
}

export function useRuntimeViewSimulatorState() {
  const data = useSimulatorStore(
    useShallow((s) => ({
      platform: s.platform,
      runtimeDialogOpen: s.runtimeDialogOpen,
      runtimeMode: s.runtimeMode,
    })),
  );

  return {
    ...data,
    setPlatform,
    setRuntimeDialogOpen,
    setRuntimeMode,
  };
}

export function useWebBrowserSimulatorState() {
  const data = useSimulatorStore(
    useShallow((s) => ({
      browserPreset: s.browserPreset,
      browserUrlBySession: s.browserUrlBySession,
      mountedSessionIds: s.mountedSessionIds,
      runtimeDialogOpen: s.runtimeDialogOpen,
    })),
  );

  return {
    ...data,
    setBrowserPreset,
    setBrowserUrl,
    ensureBrowserMounted,
  };
}

/**
 * Return the active device key for the given session + platform (the UDID for
 * iOS, the serial for Android, the `deviceId` for a video input), or null.
 * Used by the runtime live log to know which device's conductor events to
 * show, and by the popout button to know what to detach.
 */
export function useActiveDeviceKey(
  sessionId: string | null,
  platform: Platform,
): string | null {
  return useSimulatorStore((s) => {
    const key = sessionId ?? "__global__";
    if (platform === "ios") {
      return s.selectedUdidBySession[key] ?? null;
    }
    if (platform === "android") {
      return s.selectedAndroidBySession[key] ?? null;
    }
    if (platform === "video") {
      return s.selectedVideoBySession[key] ?? null;
    }

    return null;
  });
}

/** Run `cb` on every change to the runtime selection, outside React. */
export const subscribeSimulator = (cb: () => void): (() => void) =>
  simulatorStore.subscribe(cb);

/** For tests */
export const getSimulatorState = () => simulatorStore.getState();
export const setSimulatorState = simulatorStore.setState.bind(simulatorStore);
