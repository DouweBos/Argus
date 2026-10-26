/**
 * Device ids for simulators on a device host. UDIDs are only unique per Mac,
 * so a remote one is namespaced as `<hostId>~<udid>`; local ids stay bare, and
 * every id-keyed map, event channel, claim and route works on either unchanged.
 */

import { isDeviceHostId } from "./config";

const SEPARATOR = "~";

export function remoteDeviceId(hostId: string, udid: string): string {
  return `${hostId}${SEPARATOR}${udid}`;
}

/** Split an id into its host (null for this machine) and the host-local UDID. */
export function parseDeviceId(id: string): {
  hostId: string | null;
  udid: string;
} {
  const at = id.indexOf(SEPARATOR);
  if (at > 0) {
    const hostId = id.slice(0, at);
    const udid = id.slice(at + 1);
    if (isDeviceHostId(hostId) && udid) {
      return { hostId, udid };
    }
  }

  return { hostId: null, udid: id };
}

export function isRemoteDeviceId(id: string): boolean {
  return parseDeviceId(id).hostId !== null;
}
