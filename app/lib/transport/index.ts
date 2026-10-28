/**
 * The transport chokepoint. `invoke()`, `send()` and `listen()` resolve a
 * transport here; components never learn which machine answered.
 *
 * There is no single "active" transport any more. Several hosts are attached
 * at once and each call is routed to the one that owns its subject — the
 * session, agent, terminal or repo root it names (`hostRouting.ts`). Calls
 * that name nothing go to the host the URL is focused on, and this Mac is
 * always attached as a fallback.
 */

import type { HostId } from "./hostId";
import type { ArgusTransport } from "./types";
import { getFocusedConnection } from "../../stores/connectionStore";
import {
  forgetRemoteHost,
  getAttachedHostIds,
  getRemoteHost,
  setAttachedHostIds,
} from "../../stores/settingsStore";
import { LOCAL_HOST_ID } from "./hostId";
import { resolveHostId } from "./hostRouting";
import { localTransport } from "./local";
import {
  attachHost,
  detachHost,
  getConnectionTransport,
  isAttached,
  onHostState,
  subscribe,
} from "./registry";
import { HostUnavailableError } from "./types";

/**
 * Stand-in for a host nobody is attached to. Reads that already landed stay on
 * screen; anything new fails loudly instead of silently going to the wrong Mac.
 */
function detachedTransport(hostId: HostId): ArgusTransport {
  const reject = () => Promise.reject(new HostUnavailableError(hostId, hostId));

  return {
    invoke: reject as ArgusTransport["invoke"],
    send: () => undefined,
    on: () => () => undefined,
  };
}

/** The transport for one host, whether or not it is currently answering. */
export function getTransportFor(hostId: HostId): ArgusTransport {
  return getConnectionTransport(hostId) ?? detachedTransport(hostId);
}

/** The transport a given command should use, by its own subject. */
export function getTransportForCommand(
  channel: string,
  args?: Record<string, unknown>,
): ArgusTransport {
  return getTransportFor(resolveHostId(channel, args));
}

/** The transport for the host the current view reads from. */
export function getTransport(): ArgusTransport {
  return getTransportFor(getFocusedConnection().hostId);
}

/** True when the view is reading from a machine other than this one. */
export function isRemoteMode(): boolean {
  return getFocusedConnection().mode === "remote";
}

/**
 * Account computers may have moved (new routes, a tunnel on a new URL), so
 * pick up their current addresses first — but never hold the window up long.
 */
async function refreshAccountAddresses(): Promise<void> {
  const { refreshAccountHosts } = await import("../accountHosts");
  await Promise.race([
    refreshAccountHosts().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}

/**
 * Restore last session's attachments. Hosts come up in parallel and none of
 * them blocks the others — or the window — from booting.
 */
export async function initTransport(): Promise<void> {
  await refreshAccountAddresses();
  const hostIds = getAttachedHostIds();
  if (hostIds.length === 0) {
    return;
  }
  const known = hostIds.filter((id) => getRemoteHost(id) !== null);
  if (known.length !== hostIds.length) {
    // Hosts forgotten in another window — don't boot into a dead transport.
    setAttachedHostIds(known);
  }
  await Promise.allSettled(known.map((id) => attachTo(id)));
}

/**
 * Attach a paired host and remember it for the next launch. Resolves when the
 * host is ready and its projects are in the sidebar; rejects if it never
 * answers — every other host carries on either way.
 */
export async function attachTo(hostId: HostId): Promise<void> {
  wireRehydration();
  const host = getRemoteHost(hostId);
  if (!host) {
    throw new HostUnavailableError(hostId, hostId);
  }
  try {
    await attachHost(host);
  } catch (err) {
    const { markHostUnreachable } =
      await import("../../stores/connectionStore");
    markHostUnreachable(host.label);
    detachHost(hostId);
    throw err;
  }
  setAttachedHostIds([...new Set([...getAttachedHostIds(), hostId])]);
  const { hydrateHost } = await import("../hostHydration");
  await hydrateHost(hostId);
}

/**
 * Stop driving a host: close its socket and stop restoring it on launch.
 *
 * Its tabs stay exactly where they are, showing the last snapshot read-only —
 * the same degradation as a host that merely dropped. Nothing is yanked back
 * to this Mac, and writes fail with `HostUnavailableError` rather than landing
 * on the wrong machine. Use {@link forgetHost} to drop the data as well.
 */
export async function detachFrom(hostId: HostId): Promise<void> {
  if (hostId === LOCAL_HOST_ID) {
    return;
  }
  detachHost(hostId);
  setAttachedHostIds(getAttachedHostIds().filter((id) => id !== hostId));
}

/**
 * Unpair a host: detach it, then forget everything it owned — its projects,
 * its sessions and its routing entries. Unlike a detach this does clear the
 * screen, because the keys to reach that machine are gone too.
 */
export async function forgetHost(hostId: HostId): Promise<void> {
  await detachFrom(hostId);
  const { dropHostProjects } = await import("../hostHydration");
  const { forgetHost: forgetHostRoutes } = await import("./hostIndex");
  const { setFocusedHost } = await import("../../stores/connectionStore");
  if (getFocusedConnection().hostId === hostId) {
    setFocusedHost(LOCAL_HOST_ID);
  }
  dropHostProjects(hostId);
  forgetHostRoutes(hostId);
  forgetRemoteHost(hostId);
}

/**
 * Show a machine: attach it if nothing is connected yet, then bring its window
 * tab forward (opening one if there isn't one). Tabs carry the host now, so
 * "look at the mini" is a tab switch, not a re-point of whatever is on screen.
 */
export async function focusHost(hostId: HostId): Promise<void> {
  const { openHostTab } = await import("../tabActions");
  await openHostTab(hostId);
}

let rehydrationWired = false;

/**
 * Re-hydrate a host that dropped and came back: it kept running agents while
 * we were away, so the snapshot we are showing is stale. Wired on first attach
 * rather than at module load — `ipc.ts` imports this file, so module scope
 * here runs while half the renderer is still initialising.
 */
function wireRehydration(): void {
  if (rehydrationWired) {
    return;
  }
  rehydrationWired = true;
  onHostState((hostId, state, previous) => {
    if (state !== "ready" || previous !== "offline") {
      return;
    }
    import("../hostHydration")
      .then(({ hydrateHost }) => hydrateHost(hostId))
      .catch(() => undefined);
  });
}

export { subscribe, isAttached, detachHost, attachHost, onHostState };
export { localTransport };
export { LOCAL_HOST_ID };
export { HostUnavailableError, RemoteUnavailableError } from "./types";
