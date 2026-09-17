/**
 * Which device a share carries. Sharing an agent always bundles whatever the
 * host has open — there is no toggle — so this is a lookup, not a choice.
 */

import type { Platform } from "../stores/simulatorStore";
import { browserClaimId } from "@argus/remote-protocol";

export interface ShareTarget {
  androidSerial: string | null;
  iosUdid: string | null;
  platform: Platform;
}

/**
 * The claim key a guest would be granted, or "" when there is nothing to share
 * — then the room is chat-only by circumstance. Video inputs are a capture card
 * on this desk, not something a guest can drive, so they never travel.
 */
export function shareableDeviceKey(
  target: ShareTarget,
  sessionId: string,
): string {
  if (target.platform === "ios") {
    return target.iosUdid ?? "";
  }
  if (target.platform === "android") {
    return target.androidSerial ?? "";
  }
  if (target.platform === "web") {
    return browserClaimId(sessionId);
  }

  return "";
}
