import type { InputCapabilities } from "../lib/deviceInputClient";
import { useEffect, useState } from "react";
import { DeviceInputClient } from "../lib/deviceInputClient";
import { deviceInputEndpoint } from "../lib/ipc";

interface DeviceInputState {
  capabilities: InputCapabilities | null;
  client: DeviceInputClient | null;
  /** True once the handshake completed — gate the streaming path on this. */
  ready: boolean;
}

const IDLE: DeviceInputState = {
  client: null,
  capabilities: null,
  ready: false,
};

/**
 * Open conductor's streaming-input socket for a device and expose the client +
 * negotiated capabilities. `ready` is false until the handshake lands (or when
 * conductor can't provide a socket) — callers stream through `client` when
 * `ready` and the relevant capability is set, and otherwise fall back to the
 * native `simulator_*` / `android_*` IPC path.
 */
export function useDeviceInput(
  deviceKey: string | null,
  enabled: boolean,
): DeviceInputState {
  const target = enabled && deviceKey ? deviceKey : null;
  const [state, setState] = useState<DeviceInputState>(IDLE);
  // Reset to idle the moment the device changes (render-phase adjust, no effect),
  // so a stale client/ready never leaks across a device switch.
  const [syncedTo, setSyncedTo] = useState<string | null>(target);
  if (syncedTo !== target) {
    setSyncedTo(target);
    setState(IDLE);
  }

  useEffect(() => {
    if (!target) {
      return;
    }
    let cancelled = false;
    let client: DeviceInputClient | null = null;

    deviceInputEndpoint(target)
      .then((endpoint) => {
        if (cancelled || !endpoint) {
          return;
        }
        client = new DeviceInputClient(endpoint.url, {
          onCapabilities: (capabilities) => {
            if (!cancelled) {
              setState((s) => ({ ...s, capabilities, ready: true }));
            }
          },
          onClose: () => {
            if (!cancelled) {
              setState((s) => ({ ...s, ready: false }));
            }
          },
        });
        client.connect();
        if (!cancelled) {
          setState((s) => ({ ...s, client }));
        }
      })
      .catch(() => {
        /* no socket — caller falls back to native input */
      });

    return () => {
      cancelled = true;
      client?.close();
    };
  }, [target]);

  return state;
}
