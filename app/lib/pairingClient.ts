/**
 * Describing the thing on the other end of a pairing handshake.
 *
 * Pure, so the confirm screen and its test share one wording.
 */

import type { PairingClient } from "./types";

/** "Argus Remote on iPhone", or just the product when it did not say. */
export function pairingClientLabel(client: PairingClient): string {
  return client.device
    ? `${client.product} on ${client.device}`
    : client.product;
}

/**
 * Whether it makes sense to offer this client the keyboard. Only a desktop can
 * drive another desktop; a phone or a browser granted `admin` could do nothing
 * with it. An unknown client is treated as a desktop — the toggle stays, and
 * the human decides, rather than a missing field quietly removing a choice.
 */
export function canDriveArgus(client: PairingClient | null): boolean {
  return (client?.kind ?? "desktop") === "desktop";
}
