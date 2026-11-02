/**
 * The connected computer's settings a browser can see or change: the
 * automation autonomy cap and the device hosts it streams from. Everything
 * else in Settings belongs to this browser and lives in `localStorage`.
 */

import { create } from "zustand";
import { describeError } from "@argus/client-core";
import type { GatewayResult, RemoteDeviceHost } from "@argus/remote-protocol";
import { request } from "../lib/request";
import { currentTransport } from "./connection";

export type Autonomy = GatewayResult<"automations.default_autonomy">["autonomy"];

interface SettingsState {
  /** `undefined` until read; null is "no cap". */
  autonomy: Autonomy | undefined;
  autonomyError: string | null;
  deviceHosts: RemoteDeviceHost[] | null;
  deviceHostsError: string | null;

  loadAutonomy: () => Promise<void>;
  /** Resolves false when the computer refused it. */
  setAutonomy: (autonomy: Autonomy) => Promise<boolean>;
  loadDeviceHosts: (options?: { background?: boolean }) => Promise<void>;
}

const EMPTY = {
  autonomy: undefined,
  autonomyError: null,
  deviceHosts: null,
  deviceHostsError: null,
} satisfies Partial<SettingsState>;

export const useSettingsStore = create<SettingsState>()((set) => ({
  ...EMPTY,

  loadAutonomy: async () => {
    const transport = currentTransport();
    if (!transport) {
      return;
    }
    try {
      const { autonomy } = await request(
        transport,
        "automations.default_autonomy",
        {},
      );
      set({ autonomy, autonomyError: null });
    } catch (err) {
      set({ autonomyError: describeError(err) });
    }
  },

  setAutonomy: async (autonomy) => {
    const transport = currentTransport();
    if (!transport) {
      return false;
    }
    try {
      const result = await request(
        transport,
        "automations.set_default_autonomy",
        { autonomy },
      );
      set({ autonomy: result.autonomy, autonomyError: null });

      return true;
    } catch (err) {
      set({ autonomyError: describeError(err) });

      return false;
    }
  },

  loadDeviceHosts: async ({ background = false } = {}) => {
    const transport = currentTransport();
    if (!transport) {
      return;
    }
    try {
      const { hosts } = await request(
        transport,
        "device_hosts.list",
        {},
        { background },
      );
      set({ deviceHosts: hosts, deviceHostsError: null });
    } catch (err) {
      set((s) => ({
        deviceHosts: s.deviceHosts ?? [],
        deviceHostsError: describeError(err),
      }));
    }
  },
}));

export function resetSettings(): void {
  useSettingsStore.setState(EMPTY);
}
