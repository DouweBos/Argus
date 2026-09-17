import type { HostId } from "../lib/transport/hostId";
import type { DeviceInfo } from "../lib/types";
import { useEffect } from "react";
import { create } from "zustand";
import { listDevices as ipcListDevices, onHost } from "../lib/ipc";
import { hostScopedKey } from "../lib/transport/hostId";
import { getConnections } from "./connectionStore";

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

/**
 * Every attached host's devices in one list, each tagged with the machine it
 * is plugged into — two hosts can have a simulator with the same udid, and
 * booting one must not drive the other.
 */
export async function refreshDevices(): Promise<void> {
  deviceStore.setState({ loading: true });
  const results = await Promise.all(
    getConnections().map(async (connection) => {
      try {
        const devices = await onHost(connection.hostId, () => ipcListDevices());

        return devices.map((device) => ({
          ...device,
          hostId: connection.hostId,
        }));
      } catch {
        // One host being down must not blank out the others' devices.
        return [];
      }
    }),
  );
  deviceStore.setState({
    devices: results.flat(),
    loading: false,
    error: null,
  });
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
export function findDevice(
  deviceKey: string,
  hostId?: HostId,
): DeviceInfo | undefined {
  return getDevices().find(
    (d) =>
      d.deviceKey === deviceKey &&
      (hostId === undefined || d.hostId === hostId),
  );
}

/** Identity for a device across hosts — for React keys and grid selection. */
export const deviceKeyFor = (device: DeviceInfo): string =>
  hostScopedKey(device.hostId ?? "local", device.deviceKey);
