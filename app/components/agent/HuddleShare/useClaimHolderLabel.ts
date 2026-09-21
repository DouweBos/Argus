import type { RemoteDeviceClaim } from "../../../lib/deviceClaim";
import { useState } from "react";
import { useIpcEvent } from "../../../hooks/useIpcEvent";

interface ClaimChanged {
  device_id: string;
  holder: RemoteDeviceClaim | null;
}

/**
 * Who is driving the shared device right now, by label, or null when nobody
 * is. The host arbitrates a single claim per device, so with any number of
 * guests this answers with at most one name.
 *
 * The device key is stored alongside the label so switching devices reads as
 * "nobody" until that device's own claim event lands, rather than inheriting
 * the previous one's holder.
 */
export function useClaimHolderLabel(deviceKey: string): string | null {
  const [held, setHeld] = useState<{ key: string; label: string } | null>(null);

  useIpcEvent<ClaimChanged>("devices:claim-changed", (payload) => {
    if (payload.device_id !== deviceKey) {
      return;
    }
    setHeld(
      payload.holder ? { key: deviceKey, label: payload.holder.label } : null,
    );
  });

  return held?.key === deviceKey ? held.label : null;
}
