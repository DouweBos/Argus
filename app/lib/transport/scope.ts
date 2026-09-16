/**
 * Client-local state (recent projects, open projects) is per-host: the mini's
 * repo paths mean nothing on this laptop's disk. Namespacing the storage keys
 * by the attached host keeps the two lists from contaminating each other.
 *
 * Resolved synchronously from persisted settings so stores can scope their keys
 * at module load, before the socket is up.
 */

import { getActiveRemoteHostId } from "../../stores/settingsStore";

export function scopedStorageKey(key: string): string {
  const hostId = getActiveRemoteHostId();

  return hostId ? `${key}@${hostId}` : key;
}
