import type { RemoteDeviceClaim } from "../lib/deviceClaim";
import { useCallback, useEffect, useState } from "react";
import { deviceClaimStatus } from "../lib/ipc";
import { useDeviceIsShared } from "../stores/huddleStore";
import { useIpcEvent } from "./useIpcEvent";

export interface SharedDeviceDrivers {
  /** The guest driving right now, or null when nobody is. */
  holderLabel: string | null;
  /** Guests whose touches are bouncing off because someone else holds it. */
  waitingLabels: string[];
}

const NOBODY: SharedDeviceDrivers = { holderLabel: null, waitingLabels: [] };

/**
 * Who among the guests is driving one of this machine's own devices.
 *
 * The engineer's own input is never arbitrated — they sit at the machine — so
 * `useDeviceClaim` reads the local host as always-free and tells them nothing.
 * That is right for input and wrong for awareness: while a device is shared,
 * not knowing that a guest is mid-gesture (or tapping at a picture that is
 * refusing them) is how you end up fighting over a simulator in silence.
 *
 * Only live while the device is actually in a huddle; unshared it costs one
 * store read.
 */
export function useSharedDeviceDrivers(
  deviceKey: string | null,
): SharedDeviceDrivers {
  const shared = useDeviceIsShared(deviceKey);
  const [state, setState] = useState<SharedDeviceDrivers>(NOBODY);

  // A device switch must never inherit the previous one's driver, not even for
  // a frame — that would name the wrong person over the wrong screen.
  const key = shared && deviceKey ? deviceKey : "";
  const [syncedTo, setSyncedTo] = useState(key);
  if (syncedTo !== key) {
    setSyncedTo(key);
    setState(NOBODY);
  }

  const apply = useCallback(
    (payload: {
      device_id: string;
      holder: RemoteDeviceClaim | null;
      waiting?: RemoteDeviceClaim[];
    }) => {
      if (payload.device_id !== key) {
        return;
      }
      setState({
        holderLabel: payload.holder?.label ?? null,
        waitingLabels: (payload.waiting ?? []).map((w) => w.label),
      });
    },
    [key],
  );

  // Seeded as well as subscribed: opening the view after someone took the
  // device would otherwise show nobody until they next moved their finger.
  useEffect(() => {
    if (!key) {
      return;
    }
    let live = true;
    deviceClaimStatus(key)
      .then((status) => {
        if (live) {
          apply(status);
        }
      })
      .catch(() => {});

    return () => {
      live = false;
    };
  }, [key, apply]);

  useIpcEvent(key ? "devices:claim-changed" : "", apply);

  return key ? state : NOBODY;
}
