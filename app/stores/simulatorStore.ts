import { create } from "zustand";
import type { SimulatorDevice } from "../lib/types";

/** Check if a device is a tvOS (Apple TV) simulator. */
export function isTvOS(device: SimulatorDevice | undefined): boolean {
  return device?.runtime.startsWith("tvOS") ?? false;
}

const STORAGE_KEY = "stagehand:simulatorByWorkspace";

function loadSelectedByWorkspace(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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

function saveSelectedByWorkspace(map: Record<string, null | string>) {
  const toSave: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    if (v) toSave[k] = v;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
}

interface SimulatorState {
  booting: boolean;
  capturing: boolean;
  devices: SimulatorDevice[];
  disconnected: boolean;
  mjpegPort: null | number;
  selectDevice: (workspaceId: string, udid: null | string) => void;

  /** Selected simulator UDID per workspace ID */
  selectedUdidByWorkspace: Record<string, null | string>;
  setBooting: (booting: boolean) => void;
  setCapturing: (capturing: boolean) => void;
  setDevices: (devices: SimulatorDevice[]) => void;
  setDisconnected: (disconnected: boolean) => void;
  setMjpegPort: (port: null | number) => void;
}

export const useSimulatorStore = create<SimulatorState>((set) => ({
  devices: [],
  selectedUdidByWorkspace: loadSelectedByWorkspace(),
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
      if (changed) saveSelectedByWorkspace(next);
      return { devices, ...(changed ? { selectedUdidByWorkspace: next } : {}) };
    }),

  selectDevice: (workspaceId, udid) => {
    set((state) => {
      const next = { ...state.selectedUdidByWorkspace, [workspaceId]: udid };
      saveSelectedByWorkspace(next);
      return { selectedUdidByWorkspace: next, disconnected: false };
    });
  },

  setCapturing: (capturing) => set({ capturing }),
  setBooting: (booting) => set({ booting }),
  setDisconnected: (disconnected) => set({ disconnected }),
  setMjpegPort: (port) => set({ mjpegPort: port }),
}));
