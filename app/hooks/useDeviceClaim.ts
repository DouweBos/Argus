import type { HostId } from "../lib/transport/hostId";
import type {
  RemoteDeviceClaim,
  RemoteDeviceClaimState,
} from "@argus/remote-protocol";
import { useCallback, useEffect, useMemo, useState } from "react";
import { claimDenial, isBlockedBy } from "../lib/deviceClaim";
import { getTransportFor } from "../lib/transport";
import { isLocalHost } from "../lib/transport/hostId";
import { useHostConnection } from "../stores/connectionStore";
import { getRemoteHost } from "../stores/settingsStore";
import { useIpcEvent } from "./useIpcEvent";

export interface DeviceClaimState {
  /** Another client is driving — disable input rather than letting it be refused. */
  blocked: boolean;
  /** Who is driving, when it isn't us. */
  holderLabel: string | null;
  /**
   * Feed a rejected input command back in. Returns true when it was a claim
   * refusal, which it adopts — covering the race where the denial beats the
   * `devices:claim-changed` broadcast.
   */
  reportInputError: (err: unknown) => boolean;
  /** Explicit takeover: steals the claim from its current holder. */
  takeControl: () => void;
}

const FREE: DeviceClaimState = {
  blocked: false,
  holderLabel: null,
  reportInputError: () => false,
  takeControl: () => undefined,
};

/**
 * Who holds input on one device or embedded browser, on one host.
 *
 * Seeded from `devices.claim_status`, kept live by the host's broadcast, and
 * released on unmount — never polled. Claims only arbitrate between remote
 * clients: at this Mac's own devices there is nothing to arbitrate, so the
 * local host always reads as ours.
 *
 * `claimId` is a device id, or `browserClaimId(sessionId)` for an embedded
 * browser. Everything is scoped to `hostId`, so a claim on one attached host
 * says nothing about the same-named device on another.
 */
export function useDeviceClaim(
  claimId: string | null,
  hostId: HostId,
  active = true,
): DeviceClaimState {
  const remote = !isLocalHost(hostId);
  const on = active && remote && !!claimId;
  const connectionState = useHostConnection(hostId)?.state ?? "ready";
  const ready = on && connectionState === "ready";
  const selfDeviceId = remote ? (getRemoteHost(hostId)?.id ?? null) : null;

  const [holder, setHolder] = useState<RemoteDeviceClaim | null>(null);
  // Render-phase reset: a device or host switch must never inherit the
  // previous one's holder, not even for a frame.
  const key = ready ? `${hostId} ${claimId}` : "";
  const [syncedTo, setSyncedTo] = useState(key);
  if (syncedTo !== key) {
    setSyncedTo(key);
    setHolder(null);
  }

  useSeedAndRelease(ready, claimId, hostId, setHolder);

  useIpcEvent<RemoteDeviceClaimState>(
    ready ? "devices:claim-changed" : "",
    useCallback(
      (payload) => {
        if (payload?.device_id === claimId) {
          setHolder(payload.holder);
        }
      },
      [claimId],
    ),
    hostId,
  );

  const takeControl = useCallback(() => {
    if (!ready || !claimId) {
      return;
    }
    getTransportFor(hostId)
      .invoke<{ granted: boolean; holder: RemoteDeviceClaim | null }>(
        "devices.claim",
        { device_id: claimId, force: true },
      )
      .then((result) => setHolder(result.holder))
      .catch(() => undefined);
  }, [ready, claimId, hostId]);

  const reportInputError = useCallback(
    (err: unknown) => {
      const denial = claimDenial(err);
      if (!denial || denial.device_id !== claimId) {
        return false;
      }
      setHolder(denial.holder);

      return true;
    },
    [claimId],
  );

  return useMemo(() => {
    if (!on) {
      return FREE;
    }
    const blocked = isBlockedBy(holder, selfDeviceId);

    return {
      blocked,
      holderLabel: blocked ? (holder?.label ?? "another client") : null,
      reportInputError,
      takeControl,
    };
  }, [on, holder, selfDeviceId, reportInputError, takeControl]);
}

/** Seed the claim on mount and hand it back on unmount. */
function useSeedAndRelease(
  ready: boolean,
  claimId: string | null,
  hostId: HostId,
  setHolder: (holder: RemoteDeviceClaim | null) => void,
): void {
  useEffect(() => {
    if (!ready || !claimId) {
      return;
    }
    let cancelled = false;
    const transport = getTransportFor(hostId);
    transport
      .invoke<{ holder: RemoteDeviceClaim | null }>("devices.claim_status", {
        device_id: claimId,
      })
      .then((result) => {
        if (!cancelled) {
          setHolder(result.holder);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      // Hand the device back instead of making the next client wait out the
      // host's 30s idle lapse.
      transport
        .invoke("devices.release", { device_id: claimId })
        .catch(() => undefined);
    };
  }, [ready, claimId, hostId, setHolder]);
}
