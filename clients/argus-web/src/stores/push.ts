/**
 * Web Push for this browser: the user's preference and how far registration
 * got. The hosted client never registers: it serves every computer from one
 * origin, so one subscription can't belong to one of them.
 */

import { create } from "zustand";
import type { Transport } from "@argus/remote-client";
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
}

export const usePushStore = create<PushState>()((set) => ({
  pushEnabled: pushPreference(),
  pushState: "off",

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
