import type { SimulatorDeviceState } from "../lib/types";
import { useEffect, useState } from "react";
import { simulatorDeviceState } from "../lib/ipc";
import { useIpcEvent } from "./useIpcEvent";

/**
 * Fold and orientation for a captured simulator, kept live.
 *
 * The host polls the device rather than remembering what Argus last set: the
 * hinge and orientation can just as easily be moved from Device Hub or by an
 * agent running conductor, and a view that trusted its own writes would show
 * the stream the wrong way up until the next interaction.
 */
export function useSimulatorDeviceState(
  udid: string | null,
  active: boolean,
): SimulatorDeviceState | null {
  const [state, setState] = useState<SimulatorDeviceState | null>(null);
  const target = active && udid ? udid : null;

  // Drop a previous device's state during render so no frame is presented with
  // the wrong rotation.
  const [syncedTo, setSyncedTo] = useState<string | null>(target);
  if (syncedTo !== target) {
    setSyncedTo(target);
    setState(null);
  }

  useEffect(() => {
    if (!target) {
      return;
    }
    let cancelled = false;
    simulatorDeviceState(target)
      .then((s) => {
        if (!cancelled) {
          setState(s);
        }
      })
      .catch(() => {
        /* device may have gone away mid-request */
      });

    return () => {
      cancelled = true;
    };
  }, [target]);

  useIpcEvent<SimulatorDeviceState>("simulator_device_state", (next) => {
    if (target && next.udid === target) {
      setState(next);
    }
  });

  return state;
}
