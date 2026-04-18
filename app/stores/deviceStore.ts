import type { DeviceInfo } from "../lib/types";
import { useEffect } from "react";
import { create } from "zustand";
import { listDevices as ipcListDevices } from "../lib/ipc";

interface DeviceStoreData {
  devices: DeviceInfo[];
  error: string | null;
  loading: boolean;
}

const deviceStore = create<DeviceStoreData>(() => ({
  devices: [],
  loading: false,
  error: null,
}));

export const useDevices = (): DeviceInfo[] => deviceStore((s) => s.devices);

export const useDevicesError = (): string | null => deviceStore((s) => s.error);

export const getDevices = (): DeviceInfo[] => deviceStore.getState().devices;

/** Subscribe to device list changes. Returns an unsubscribe function. */
export const subscribeDevices = (
  listener: (devices: DeviceInfo[]) => void,
): (() => void) => deviceStore.subscribe((s) => listener(s.devices));

export async function refreshDevices(): Promise<void> {
  deviceStore.setState({ loading: true });
  try {
    const devices = await ipcListDevices();
    deviceStore.setState({ devices, loading: false, error: null });
  } catch (e) {
    deviceStore.setState({
      loading: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

let globalPollTimer: ReturnType<typeof setInterval> | null = null;

/** Start a global poll on app boot so the sidebar count is always fresh. */
export function initDevicePolling(intervalMs = 5000): void {
  if (globalPollTimer) {
    return;
  }
  refreshDevices();
  globalPollTimer = setInterval(() => {
    refreshDevices();
  }, intervalMs);
}

/** Subscribe a component to device list refresh on an interval. */
export function useDevicePoller(intervalMs = 5000): void {
  useEffect(() => {
    refreshDevices();
    const id = setInterval(() => {
      refreshDevices();
    }, intervalMs);

    return () => clearInterval(id);
  }, [intervalMs]);
}

/** Find an in-memory device by key (may be stale until the next poll). */
export function findDevice(deviceKey: string): DeviceInfo | undefined {
  return getDevices().find((d) => d.deviceKey === deviceKey);
}
