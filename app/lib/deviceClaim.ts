/**
 * Reading the host's input claim, without React.
 *
 * A host lets one client at a time inject input into a device or an embedded
 * browser. Everyone else is view-only until they take over. These helpers turn
 * what the host says — the `devices:claim-changed` broadcast, or the refusal
 * riding a denied input command — into "is this me, or am I locked out".
 */

import type {
  RemoteDeviceClaim,
  RemoteDeviceClaimState,
} from "@argus/remote-protocol";

export type { RemoteDeviceClaim, RemoteDeviceClaimState };

/**
 * True when someone else holds the claim. `selfDeviceId` is the device id this
 * host issued us at pairing — stable across reconnects, so our own earlier
 * connection still reads as us.
 */
export function isBlockedBy(
  holder: RemoteDeviceClaim | null,
  selfDeviceId: string | null,
): boolean {
  return holder !== null && holder.device_id !== selfDeviceId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The claim state a `capability_denied` carries, or null for any other error. */
export function claimDenial(err: unknown): RemoteDeviceClaimState | null {
  if (!isRecord(err) || err.code !== "capability_denied") {
    return null;
  }
  const data = err.data;
  if (!isRecord(data) || typeof data.device_id !== "string") {
    return null;
  }
  const holder = data.holder;
  if (holder !== null && !isRecord(holder)) {
    return null;
  }

  return {
    device_id: data.device_id,
    holder: holder === null ? null : (holder as unknown as RemoteDeviceClaim),
  };
}
