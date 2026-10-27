/**
 * The desktop's remote-access actions that stitch several services together:
 * trust-store edits that must also drop live sockets, pairing with its event
 * fan-out, and the status broadcast.
 */

import { emitHostEvent } from "@argus/host/bus";
import { blockAccountDevice } from "../account/trust";
import { openExternalUrl } from "../shell/operations";
import {
  getDevice,
  listDevices,
  revokeDevice,
  setDeviceGrants,
  type DeviceGrants,
  type PairedDevice,
} from "./deviceStore";
import { disconnectDevice } from "./gateway";
import { startPairing, type PairingStart } from "./pairing";
import {
  getPublicUrl,
  getRemoteStatus,
  setRemoteStatusListener,
  type RemoteStatus,
} from "./remoteService";
import {
  applyTailscaleFix,
  type TailscaleFixKind,
  type TailscaleFixResult,
} from "./tailscaleSetup";

/** Browser-completed fixes (sign-in, enabling Funnel) hand back a URL to open. */
export async function applyTailscaleFixAndOpen(
  fix: TailscaleFixKind,
  url?: string | null,
): Promise<TailscaleFixResult> {
  const result = await applyTailscaleFix(fix, url);
  if (result.openUrl) {
    openExternalUrl(result.openUrl);
  }

  return result;
}

export async function revokeRemoteDevice(
  deviceId: string,
): Promise<RemoteStatus> {
  if ((await getDevice(deviceId))?.source === "account") {
    await blockAccountDevice(deviceId);
  }
  await revokeDevice(deviceId);
  disconnectDevice(deviceId);

  return getRemoteStatus();
}

export async function setRemoteDeviceGrants(
  deviceId: string,
  grants: DeviceGrants,
): Promise<PairedDevice[]> {
  await setDeviceGrants(deviceId, grants);
  // The gateway pins capabilities per-connection at handshake time.
  disconnectDevice(deviceId);

  return listDevices();
}

/** Progress arrives as `remote:pairing-*` events. */
export function startRemotePairing(): Promise<PairingStart> {
  return startPairing(getPublicUrl(), {
    onSas: (sas, client) =>
      emitHostEvent("remote:pairing-sas", { sas, client }),
    onPaired: (device) => emitHostEvent("remote:pairing-complete", { device }),
    onError: (message) => emitHostEvent("remote:pairing-error", { message }),
  });
}

/** Push `remote:status` whenever the tunnels, devices or connections change. */
export function installRemoteStatusBroadcast(): void {
  setRemoteStatusListener(() => {
    getRemoteStatus()
      .then((status) => emitHostEvent("remote:status", status))
      .catch(() => {});
  });
}
