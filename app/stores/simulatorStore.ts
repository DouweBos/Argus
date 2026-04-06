import { create } from "zustand";
import type { AndroidDevice, SimulatorDevice } from "../lib/types";

/** Check if a device is a tvOS (Apple TV) simulator. */
export function isTvOS(device: SimulatorDevice | undefined): boolean {
  return device?.runtime.startsWith("tvOS") ?? false;
}

const STORAGE_KEY = "stagehand:simulatorByWorkspace";
const ANDROID_STORAGE_KEY = "stagehand:androidByWorkspace";
const PLATFORM_STORAGE_KEY = "stagehand:platform";

function loadSelectedByWorkspace(key: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === "string" && typeof v === "string") result[k] = v;
    }
    return result;
  } catch {
    return {};
  }
}

function saveSelectedByWorkspace(
  key: string,
  map: Record<string, null | string>,
) {
  const toSave: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    if (v) toSave[k] = v;
  }
  localStorage.setItem(key, JSON.stringify(toSave));
}

function loadPlatform(): "android" | "ios" {
  try {
    const raw = localStorage.getItem(PLATFORM_STORAGE_KEY);
    if (raw === "android") return "android";
  } catch {
    // ignore
  }
  return "ios";
}

export type Platform = "android" | "ios";

interface SimulatorState {
  // --- Shared ---
  platform: Platform;
  setPlatform: (platform: Platform) => void;

  // --- iOS ---
  iosToolsAvailable: boolean | null;
  iosToolsError: string | null;
  setIosToolsStatus: (available: boolean, error: string | null) => void;
  booting: boolean;
  capturing: boolean;
  devices: SimulatorDevice[];
  disconnected: boolean;
  mjpegPort: null | number;
  selectDevice: (workspaceId: string, udid: null | string) => void;
  selectedUdidByWorkspace: Record<string, null | string>;
  setBooting: (booting: boolean) => void;
  setCapturing: (capturing: boolean) => void;
  setDevices: (devices: SimulatorDevice[]) => void;
  setDisconnected: (disconnected: boolean) => void;
  setMjpegPort: (port: null | number) => void;

  // --- Android ---
  androidToolsAvailable: boolean | null;
  androidToolsError: string | null;
  setAndroidToolsStatus: (available: boolean, error: string | null) => void;
  androidBooting: boolean;
  androidCapturing: boolean;
  androidDevices: AndroidDevice[];
  androidDisconnected: boolean;
  selectAndroidDevice: (workspaceId: string, serial: null | string) => void;
  selectedAndroidByWorkspace: Record<string, null | string>;
  setAndroidBooting: (booting: boolean) => void;
  setAndroidCapturing: (capturing: boolean) => void;
  setAndroidDevices: (devices: AndroidDevice[]) => void;
  setAndroidDisconnected: (disconnected: boolean) => void;
}

export const useSimulatorStore = create<SimulatorState>((set) => ({
  // --- Shared ---
  platform: loadPlatform(),
  setPlatform: (platform) => {
    localStorage.setItem(PLATFORM_STORAGE_KEY, platform);
    set({ platform });
  },

  // --- iOS ---
  iosToolsAvailable: null,
  iosToolsError: null,
  setIosToolsStatus: (available, error) =>
    set({ iosToolsAvailable: available, iosToolsError: error }),
  devices: [],
  selectedUdidByWorkspace: loadSelectedByWorkspace(STORAGE_KEY),
  capturing: false,
  booting: false,
  disconnected: false,
  mjpegPort: null,

  setDevices: (devices) =>
    set((state) => {
      const deviceUdids = new Set(devices.map((d) => d.udid));
      let changed = false;
      const next: Record<string, null | string> = {};
      for (const [wsId, udid] of Object.entries(
        state.selectedUdidByWorkspace,
      )) {
        if (udid && !deviceUdids.has(udid)) {
          next[wsId] = null;
          changed = true;
        } else {
          next[wsId] = udid;
        }
      }
      if (changed) saveSelectedByWorkspace(STORAGE_KEY, next);
      return { devices, ...(changed ? { selectedUdidByWorkspace: next } : {}) };
    }),

  selectDevice: (workspaceId, udid) => {
    set((state) => {
      const next = { ...state.selectedUdidByWorkspace, [workspaceId]: udid };
      saveSelectedByWorkspace(STORAGE_KEY, next);
      return { selectedUdidByWorkspace: next, disconnected: false };
    });
  },

  setCapturing: (capturing) => set({ capturing }),
  setBooting: (booting) => set({ booting }),
  setDisconnected: (disconnected) => set({ disconnected }),
  setMjpegPort: (port) => set({ mjpegPort: port }),

  // --- Android ---
  androidToolsAvailable: null,
  androidToolsError: null,
  setAndroidToolsStatus: (available, error) =>
    set({ androidToolsAvailable: available, androidToolsError: error }),
  androidDevices: [],
  selectedAndroidByWorkspace: loadSelectedByWorkspace(ANDROID_STORAGE_KEY),
  androidCapturing: false,
  androidBooting: false,
  androidDisconnected: false,

  setAndroidDevices: (devices) =>
    set((state) => {
      const serials = new Set(devices.map((d) => d.serial));
      let changed = false;
      const next: Record<string, null | string> = {};
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
      if (changed) saveSelectedByWorkspace(ANDROID_STORAGE_KEY, next);
      return {
        androidDevices: devices,
        ...(changed ? { selectedAndroidByWorkspace: next } : {}),
      };
    }),

  selectAndroidDevice: (workspaceId, serial) => {
    set((state) => {
      const next = {
        ...state.selectedAndroidByWorkspace,
        [workspaceId]: serial,
      };
      saveSelectedByWorkspace(ANDROID_STORAGE_KEY, next);
      return { selectedAndroidByWorkspace: next, androidDisconnected: false };
    });
  },

  setAndroidCapturing: (capturing) => set({ androidCapturing: capturing }),
  setAndroidBooting: (booting) => set({ androidBooting: booting }),
  setAndroidDisconnected: (disconnected) =>
    set({ androidDisconnected: disconnected }),
}));
