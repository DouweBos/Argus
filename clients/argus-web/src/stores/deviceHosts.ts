/**
 * Device hosts (other Macs over SSH, EAS Simulator hosts): a read-only list,
 * bar starting and ending an EAS session. Mirrors `HostStore+Devices`' device
 * hosts.
 */

import { create } from "zustand";
import {
  describeError,
  INITIAL_LOAD,
  isQuietError,
  type LoadState,
} from "@argus/client-core";
import type { RemoteDeviceHost } from "@argus/remote-protocol";
import { request } from "../lib/request";
import { currentTransport } from "./connection";

interface DeviceHostsState {
  hosts: RemoteDeviceHost[];
  hostsLoad: LoadState;

  refreshDeviceHosts: (options?: { background?: boolean }) => Promise<void>;
  /** Billed to the computer's Expo account: confirm before calling. */
  startEasSession: (hostId: string) => Promise<void>;
  stopEasSession: (deviceId: string) => Promise<void>;
}

function requireTransport() {
  const t = currentTransport();
  if (!t) {
    throw new Error("Not connected to the computer.");
  }

  return t;
}

export const useDeviceHostsStore = create<DeviceHostsState>()((set, get) => ({
  hosts: [],
  hostsLoad: INITIAL_LOAD,

  refreshDeviceHosts: async (options) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    try {
      const { hosts } = await request(t, "device_hosts.list", {});
      set({ hosts, hostsLoad: { loaded: true, error: null } });
    } catch (err) {
      if (!isQuietError(err, options?.background ?? false)) {
        set({ hostsLoad: { loaded: true, error: describeError(err) } });
      }
    }
  },

  startEasSession: async (hostId) => {
    await request(requireTransport(), "device_hosts.start_eas_session", {
      host_id: hostId,
    });
    // The running count moved; the new device itself arrives via devices.list.
    get()
      .refreshDeviceHosts({ background: true })
      .catch(() => {});
  },

  stopEasSession: async (deviceId) => {
    await request(requireTransport(), "device_hosts.stop_eas_session", {
      device_id: deviceId,
    });
  },
}));

/** A new host: its device hosts aren't the last one's. */
export function resetDeviceHosts(): void {
  useDeviceHostsStore.setState({ hosts: [], hostsLoad: INITIAL_LOAD });
}
