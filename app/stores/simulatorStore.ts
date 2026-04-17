import type { AndroidDevice, SimulatorDevice } from "../lib/types";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

/** Check if a device is a tvOS (Apple TV) simulator. */
export function isTvOS(device: SimulatorDevice | undefined): boolean {
  return device?.runtime.startsWith("tvOS") ?? false;
}

const STORAGE_KEY = "argus:simulatorByWorkspace";
const ANDROID_STORAGE_KEY = "argus:androidByWorkspace";
const PLATFORM_STORAGE_KEY = "argus:platform";
const BROWSER_PRESET_STORAGE_KEY = "argus:browserPreset";

function loadSelectedByWorkspace(key: string): Record<string, string> {
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

function saveSelectedByWorkspace(
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

export type Platform = "android" | "ios" | "web";

interface SimulatorStoreData {
  androidBooting: boolean;
  androidCapturing: boolean;
  androidDevices: AndroidDevice[];
  androidDisconnected: boolean;
  androidToolsAvailable: boolean | null;
  androidToolsError: string | null;
  booting: boolean;
  browserPreset: string;
  browserUrlByWorkspace: Record<string, string>;
  capturing: boolean;
  devices: SimulatorDevice[];
  disconnected: boolean;
  iosToolsAvailable: boolean | null;
  iosToolsError: string | null;
  mjpegPort: number | null;
  /**
   * Set of workspace IDs whose web `<webview>` is mounted in the stack.
   * A workspace is added to this set the first time it is needed — either
   * when the user opens its Web runtime tab, or when an agent issues a
   * Conductor web command and the backend asks us to mount it via the
   * `browser:ensure_mounted` event. Once mounted we keep the webview alive
   * for the rest of the session so Conductor stays attached.
   */
  mountedWorkspaceIds: Record<string, true>;
  platform: Platform;
  /** Simulator runtime (iOS / Android / Web) shown in the tool panel or in a fullscreen-style dialog */
  runtimeDialogOpen: boolean;
  selectedAndroidByWorkspace: Record<string, string | null>;
  selectedUdidByWorkspace: Record<string, string | null>;
}

const simulatorStore = create<SimulatorStoreData>(() => ({
  platform: loadPlatform(),
  iosToolsAvailable: null,
  iosToolsError: null,
  devices: [],
  selectedUdidByWorkspace: loadSelectedByWorkspace(STORAGE_KEY),
  capturing: false,
  booting: false,
  disconnected: false,
  mjpegPort: null,
  androidToolsAvailable: null,
  androidToolsError: null,
  androidDevices: [],
  selectedAndroidByWorkspace: loadSelectedByWorkspace(ANDROID_STORAGE_KEY),
  androidCapturing: false,
  androidBooting: false,
  androidDisconnected: false,
  browserPreset: loadBrowserPreset(),
  browserUrlByWorkspace: {},
  mountedWorkspaceIds: {},
  runtimeDialogOpen: false,
}));

const useSimulatorStore = simulatorStore;

export const setPlatform = (platform: Platform) => {
  localStorage.setItem(PLATFORM_STORAGE_KEY, platform);
  simulatorStore.setState({ platform });
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
    for (const [wsId, udid] of Object.entries(state.selectedUdidByWorkspace)) {
      if (udid && !deviceUdids.has(udid)) {
        next[wsId] = null;
        changed = true;
      } else {
        next[wsId] = udid;
      }
    }

    if (changed) {
      saveSelectedByWorkspace(STORAGE_KEY, next);
    }

    return { devices, ...(changed ? { selectedUdidByWorkspace: next } : {}) };
  });
};

export const selectDevice = (workspaceId: string, udid: string | null) => {
  simulatorStore.setState((state) => {
    const next = { ...state.selectedUdidByWorkspace, [workspaceId]: udid };
    saveSelectedByWorkspace(STORAGE_KEY, next);

    return { selectedUdidByWorkspace: next, disconnected: false };
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

export const setMjpegPort = (port: number | null) => {
  simulatorStore.setState({ mjpegPort: port });
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
      state.selectedAndroidByWorkspace,
    )) {
      if (serial && !serials.has(serial)) {
        next[wsId] = null;
        changed = true;
      } else {
        next[wsId] = serial;
      }
    }

    if (changed) {
      saveSelectedByWorkspace(ANDROID_STORAGE_KEY, next);
    }

    return {
      androidDevices: devices,
      ...(changed ? { selectedAndroidByWorkspace: next } : {}),
    };
  });
};

export const selectAndroidDevice = (
  workspaceId: string,
  serial: string | null,
) => {
  simulatorStore.setState((state) => {
    const next = {
      ...state.selectedAndroidByWorkspace,
      [workspaceId]: serial,
    };
    saveSelectedByWorkspace(ANDROID_STORAGE_KEY, next);

    return { selectedAndroidByWorkspace: next, androidDisconnected: false };
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

export const setBrowserUrl = (workspaceId: string, url: string) => {
  simulatorStore.setState((state) => ({
    browserUrlByWorkspace: {
      ...state.browserUrlByWorkspace,
      [workspaceId]: url,
    },
  }));
};

export const ensureBrowserMounted = (workspaceId: string) => {
  simulatorStore.setState((state) => {
    if (state.mountedWorkspaceIds[workspaceId]) {
      return state;
    }

    return {
      mountedWorkspaceIds: {
        ...state.mountedWorkspaceIds,
        [workspaceId]: true,
      },
    };
  });
};

export function useAndroidDeviceSimulatorState() {
  const data = useSimulatorStore(
    useShallow((s) => ({
      androidToolsAvailable: s.androidToolsAvailable,
      androidDevices: s.androidDevices,
      selectedAndroidByWorkspace: s.selectedAndroidByWorkspace,
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
      selectedUdidByWorkspace: s.selectedUdidByWorkspace,
      capturing: s.capturing,
      mjpegPort: s.mjpegPort,
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
      selectedUdidByWorkspace: s.selectedUdidByWorkspace,
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

export function useRuntimeViewSimulatorState() {
  const data = useSimulatorStore(
    useShallow((s) => ({
      platform: s.platform,
      runtimeDialogOpen: s.runtimeDialogOpen,
    })),
  );

  return {
    ...data,
    setPlatform,
    setRuntimeDialogOpen,
  };
}

export function useWebBrowserSimulatorState() {
  const data = useSimulatorStore(
    useShallow((s) => ({
      browserPreset: s.browserPreset,
      browserUrlByWorkspace: s.browserUrlByWorkspace,
      mountedWorkspaceIds: s.mountedWorkspaceIds,
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

/** For tests */
export const getSimulatorState = () => simulatorStore.getState();
export const setSimulatorState = simulatorStore.setState.bind(simulatorStore);
