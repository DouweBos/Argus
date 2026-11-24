/**
 * Web Push for this browser: the user's preference and how far registration
 * got. The hosted client never registers: it serves every computer from one
 * origin, so one subscription can't belong to one of them.
 */

import { create } from "zustand";
import type { NotificationPrefs } from "@argus/remote-protocol";
import type { Transport } from "@argus/remote-client";
import { request } from "../lib/request";
import {
  pushPreference,
  registerWebPush,
  setPushPreference,
  unregisterWebPush,
  type WebPushState,
} from "../lib/webpush";
import { currentTransport, readyTransport } from "./connection";

interface PushState {
  /** Whether the user wants background push in this browser. */
  pushEnabled: boolean;
  /** Where Web Push registration got to; drives the Settings copy. */
  pushState: WebPushState;

  setPushEnabled: (enabled: boolean) => Promise<void>;
  /** Alert categories this browser wants; the computer never sends one that's off. */
  alerts: NotificationPrefs;
  setAlert: (category: keyof NotificationPrefs, on: boolean) => Promise<void>;
}

const ALERTS_KEY = "argus.alerts";

function readAlerts(): NotificationPrefs {
  try {
    const saved = JSON.parse(
      localStorage.getItem(ALERTS_KEY) ?? "{}",
    ) as Partial<NotificationPrefs>;

    return {
      needs_you: saved.needs_you !== false,
      finished: saved.finished !== false,
    };
  } catch {
    return { needs_you: true, finished: true };
  }
}

/** Tell the computer this browser's alert categories; an older one doesn't know the method. */
export function syncAlertsOn(transport: Transport): void {
  request(
    transport,
    "device.set_notifications",
    usePushStore.getState().alerts,
  ).catch(() => {});
}

export const usePushStore = create<PushState>()((set, get) => ({
  pushEnabled: pushPreference(),
  pushState: "off",
  alerts: readAlerts(),

  setAlert: async (category, on) => {
    const alerts = { ...get().alerts, [category]: on };
    set({ alerts });
    try {
      localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts));
    } catch {
      // Still sent for this connection; the next visit falls back to both on.
    }
    const transport = readyTransport();
    if (transport) {
      syncAlertsOn(transport);
    }
  },

  setPushEnabled: async (enabled) => {
    setPushPreference(enabled);
    set({ pushEnabled: enabled });
    if (!enabled) {
      await unregisterWebPush(currentTransport());
      set({ pushState: "off" });

      return;
    }
    const transport = readyTransport();
    if (transport) {
      set({ pushState: await registerWebPush(transport) });
    }
  },
}));

/** A paired connection came up: (re)register this browser's subscription. */
export function registerPushOn(transport: Transport): void {
  registerWebPush(transport)
    .then((pushState) => usePushStore.setState({ pushState }))
    .catch(() => {});
}

export function pushWentOffline(): void {
  usePushStore.setState({ pushState: "off" });
}

/** Forgetting the pairing: tell the computer to stop pushing here. */
export function unregisterPush(transport: Transport | null): void {
  void unregisterWebPush(transport);
}
