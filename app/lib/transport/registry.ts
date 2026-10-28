/**
 * The connection registry: every host the window is driving, keyed by host id.
 *
 * This Mac is always in it under `LOCAL_HOST_ID`; each attached paired host
 * gets its own `RemoteTransport`, its own socket and backoff, and its own
 * event subscriptions. Nothing is shared between them — an `agent:status` from
 * the mini is delivered only to listeners that asked the mini, and a host
 * going offline touches nothing but its own entry.
 */

import type { ArgusTransport } from "./types";
import type { ConnectionState } from "@argus/remote-client";
import {
  addHostConnection,
  getHostConnection,
  removeHostConnection,
  setHostConnection,
} from "../../stores/connectionStore";
import {
  updateRemoteHostRoutes,
  type RemoteHost,
} from "../../stores/settingsStore";
import { attachBudgetMs } from "./endpointRanking";
import { LOCAL_HOST_ID, isLocalHost, type HostId } from "./hostId";
import { localTransport } from "./local";
import { RemoteTransport } from "./remote";
import { HostUnavailableError } from "./types";

interface Connection {
  hostId: HostId;
  label: string;
  remote: RemoteTransport | null;
  transport: ArgusTransport;
}

const connections = new Map<HostId, Connection>([
  [
    LOCAL_HOST_ID,
    {
      hostId: LOCAL_HOST_ID,
      label: "This Mac",
      remote: null,
      transport: localTransport,
    },
  ],
]);

/** Called when a host's socket state changes, so callers can re-hydrate. */
export type HostStateListener = (
  hostId: HostId,
  state: ConnectionState,
  previous: ConnectionState,
) => void;

const stateListeners = new Set<HostStateListener>();

export function onHostState(listener: HostStateListener): () => void {
  stateListeners.add(listener);

  return () => stateListeners.delete(listener);
}

// --- Event fan-out ---------------------------------------------------------

interface Subscription {
  event: string;
  handler: (payload: unknown, hostId: HostId) => void;
  /** One live listener per attached host, so nothing crosses between them. */
  unlistens: Map<HostId, () => void>;
}

const subscriptions = new Set<Subscription>();

function bind(subscription: Subscription, connection: Connection): void {
  const unlisten = connection.transport.on<unknown>(
    subscription.event,
    (payload) => subscription.handler(payload, connection.hostId),
  );
  subscription.unlistens.set(connection.hostId, unlisten);
}

/**
 * Listen on one host, or on every attached host at once. The handler is always
 * told which host spoke — two hosts can be running an agent with the same id
 * in principle, and always have overlapping channel names.
 */
export function subscribe<T = unknown>(
  event: string,
  handler: (payload: T, hostId: HostId) => void,
  hostId?: HostId,
): () => void {
  const fanout = handler as (payload: unknown, hostId: HostId) => void;
  if (hostId) {
    const connection = connections.get(hostId);
    if (!connection) {
      return () => undefined;
    }

    return connection.transport.on<unknown>(event, (payload) =>
      fanout(payload, hostId),
    );
  }

  const subscription: Subscription = {
    event,
    handler: fanout,
    unlistens: new Map(),
  };
  subscriptions.add(subscription);
  for (const connection of connections.values()) {
    bind(subscription, connection);
  }

  return () => {
    subscriptions.delete(subscription);
    for (const off of subscription.unlistens.values()) {
      off();
    }
    subscription.unlistens.clear();
  };
}

// --- Attach / detach -------------------------------------------------------

export function getConnectionTransport(hostId: HostId): ArgusTransport | null {
  return connections.get(hostId)?.transport ?? null;
}

export function attachedHostIds(): HostId[] {
  return [...connections.keys()];
}

export function isAttached(hostId: HostId): boolean {
  return connections.has(hostId);
}

/**
 * Bring a paired host online. Resolves once its gateway is ready; rejects if
 * it never answers, leaving every other host untouched.
 */
export function attachHost(
  host: RemoteHost,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const existing = connections.get(host.id);
  if (existing) {
    return Promise.resolve();
  }

  wireNetworkChanges();
  const remote = new RemoteTransport(host, {
    onState: (state) => handleState(host.id, state),
    onRoute: (url) => updateRemoteHostRoutes(host.id, { url }),
    onEndpoints: (endpoints) => updateRemoteHostRoutes(host.id, { endpoints }),
  });
  const connection: Connection = {
    hostId: host.id,
    label: host.label,
    remote,
    transport: remote,
  };
  connections.set(host.id, connection);
  addHostConnection({
    hostId: host.id,
    label: host.label,
    mode: "remote",
    state: "connecting",
    hydrated: false,
    lastError: null,
    attachedAt: Date.now(),
  });
  for (const subscription of subscriptions) {
    bind(subscription, connection);
  }
  remote.connect();

  // Long enough to fall back through every route before giving up.
  return waitForReady(
    host.id,
    options.timeoutMs ??
      Math.max(8000, attachBudgetMs(host.url, host.endpoints)),
  );
}

let networkWired = false;

/** Back online or on another network: every host retries or looks for a better route. */
function wireNetworkChanges(): void {
  if (networkWired || typeof window.addEventListener !== "function") {
    return;
  }
  networkWired = true;
  const changed = () => {
    for (const connection of connections.values()) {
      connection.remote?.onNetworkChange();
    }
  };
  window.addEventListener("online", changed);
  // Chromium's Network Information API: fires on a Wi-Fi or interface switch.
  const info = (
    globalThis.navigator as { connection?: EventTarget } | undefined
  )?.connection;
  info?.addEventListener("change", changed);
}

/**
 * Take a host's socket down. Its routing entries stay: a call about one of its
 * sessions must still resolve to it and fail loudly, never fall through to
 * this Mac. `forgetHost()` in `hostIndex` clears those when a host is unpaired.
 */
export function detachHost(hostId: HostId): void {
  if (isLocalHost(hostId)) {
    return;
  }
  const connection = connections.get(hostId);
  if (!connection) {
    return;
  }
  for (const subscription of subscriptions) {
    subscription.unlistens.get(hostId)?.();
    subscription.unlistens.delete(hostId);
  }
  connection.remote?.disconnect();
  connections.delete(hostId);
  removeHostConnection(hostId);
}

function handleState(hostId: HostId, state: ConnectionState): void {
  const previous = getHostConnection(hostId)?.state ?? "connecting";
  setHostConnection(hostId, {
    state,
    // The snapshot is stale the moment the socket drops — the host keeps
    // running agents while we are away.
    ...(state === "offline" ? { hydrated: false } : {}),
  });
  for (const listener of stateListeners) {
    listener(hostId, state, previous);
  }
}

function waitForReady(hostId: HostId, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (!connections.has(hostId)) {
        clearInterval(timer);
        reject(new HostUnavailableError(hostId, "detached"));

        return;
      }
      if (getHostConnection(hostId)?.state === "ready") {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(
          new HostUnavailableError(
            hostId,
            getHostConnection(hostId)?.label ?? hostId,
          ),
        );
      }
    }, 50);
  });
}

/** Test seam — drops every remote connection and subscription. */
export function resetRegistry(): void {
  for (const hostId of [...connections.keys()]) {
    detachHost(hostId);
  }
  subscriptions.clear();
  stateListeners.clear();
}
