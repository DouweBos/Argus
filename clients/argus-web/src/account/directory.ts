/**
 * Account computers as this browser can use them. A page served over https
 * may only open `wss://` sockets, so a host's LAN and tailnet addresses are
 * dropped and only its managed tunnel (or any other `wss://` route) is kept.
 */

import type {
  DirectoryRecord,
  HostMember,
  LogState,
  PresenceEndpoint,
} from "@argus/remote-protocol/account";
import { verifyPresence } from "@argus/remote-protocol/account";
import type { CachedPresence } from "./vault";

/** A host is online when it checked in within this window (wire contract). */
export const ONLINE_WINDOW_MS = 15 * 60_000;

export interface AccountComputer {
  id: string;
  name: string;
  platform: HostMember["platform"];
  noisePub: string;
  online: boolean;
  lastSeen: number | null;
  /** `wss://` routes, best first. Empty: nothing a browser can dial. */
  routes: PresenceEndpoint[];
}

export function isOnline(lastSeen: number | null, now: number): boolean {
  return lastSeen !== null && now - lastSeen <= ONLINE_WINDOW_MS;
}

/** Same order as every other client (lowest priority first), minus what a browser can't dial. */
export function browserRoutes(
  endpoints: readonly PresenceEndpoint[],
): PresenceEndpoint[] {
  const seen = new Set<string>();

  return endpoints
    .filter((e) => e.url.startsWith("wss://") && !seen.has(e.url) && seen.add(e.url))
    .sort((a, b) => a.priority - b.priority);
}

/**
 * Fold fresh directory records into the cache: only records the host signed
 * for this account count, and a record older than the one held is ignored.
 */
export function mergePresence(
  state: LogState,
  held: Record<string, CachedPresence>,
  records: readonly DirectoryRecord[],
): Record<string, CachedPresence> {
  const next = { ...held };
  for (const record of records) {
    const presence = verifyPresence(state, record);
    if (!presence) {
      continue;
    }
    const prior = next[record.host_id];
    if (prior && prior.ts > presence.ts) {
      continue;
    }
    next[record.host_id] = {
      ts: presence.ts,
      lastSeen: record.last_seen,
      endpoints: presence.endpoints,
    };
  }

  return next;
}

export function accountComputers(
  state: LogState,
  presence: Record<string, CachedPresence>,
  now: number,
): AccountComputer[] {
  return Object.values(state.members)
    .filter((m) => m.live && m.member.role === "host")
    .map(({ member }) => {
      const host = member as HostMember;
      const held = presence[host.id];

      return {
        id: host.id,
        name: host.name,
        platform: host.platform,
        noisePub: host.noise_pub,
        online: isOnline(held?.lastSeen ?? null, now),
        lastSeen: held?.lastSeen ?? null,
        routes: browserRoutes(held?.endpoints ?? []),
      };
    })
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}

/** "Online", "Last seen 5 min ago", "Never seen". */
export function presenceLabel(computer: AccountComputer, now: number): string {
  if (computer.online) {
    return "Online";
  }
  if (computer.lastSeen === null) {
    return "Not seen yet";
  }
  const minutes = Math.round((now - computer.lastSeen) / 60_000);
  if (minutes < 60) {
    return `Last seen ${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `Last seen ${hours} h ago`;
  }

  return `Last seen ${Math.round(hours / 24)} days ago`;
}
