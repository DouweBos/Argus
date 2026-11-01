/**
 * The host connection: who we are, the live transport, its state and our
 * grants. Mirrors ArgusCore's `AppStore` + `HostStore` core. Domain stores
 * read the transport from here; what happens on an event, a reconnect or a
 * host switch is wired in `hostSync.ts`, so this file imports no domain store.
 */

import { create } from "zustand";
import {
  MediaRouter,
  Transport,
  type ConnectionState,
  type EventEnvelope,
  type TransportOptions,
} from "@argus/remote-client";
import type { GatewayMethod } from "@argus/remote-protocol";
import {
  clearIdentity,
  credentialsFor,
  defaultDeviceName,
  loadIdentity,
  saveIdentity,
  type DeviceIdentity,
} from "../lib/keystore";
import { request } from "../lib/request";

/** What `hostSync.ts` plugs in: the domain side of a connection. */
export interface ConnectionHooks {
  /** Every event the host pushes. */
  event: (event: EventEnvelope) => void;
  /** Each time a paired (non-guest) connection's channel comes up. */
  ready: (transport: Transport, identity: DeviceIdentity) => void;
  /** Each time it goes down or starts dialling again. */
  notReady: () => void;
  /** A different host (or none) is now in front: drop what the last one sent. */
  reset: () => void;
  /** About to forget this pairing, while the transport is still up. */
  unpairing: (transport: Transport | null) => void;
}

const NO_HOOKS: ConnectionHooks = {
  event: () => {},
  ready: () => {},
  notReady: () => {},
  reset: () => {},
  unpairing: () => {},
};

let hooks: ConnectionHooks = NO_HOOKS;

export function installConnectionHooks(next: ConnectionHooks): void {
  hooks = next;
}

export function connectionHooks(): ConnectionHooks {
  return hooks;
}

/** Pings over the Noise channel: a browser can't send WebSocket ping frames. */
export const TRANSPORT_OPTIONS: TransportOptions = {
  keepalive: { method: "host.ping" satisfies GatewayMethod },
};

/** Binary media routing, kept out of reactive state: hot path, no re-render. */
export const media = new MediaRouter();

interface ConnectionState_ {
  identity: DeviceIdentity | null;
  deviceName: string;
  connection: ConnectionState;
  transport: Transport | null;
  /** This device's capability grants (seeded from pairing, refreshed live). */
  capabilities: string[];

  init: () => void;
  pairComplete: (identity: DeviceIdentity) => void;
  /** Connect to an account computer (hosted client); nothing is persisted here. */
  openAccountHost: (identity: DeviceIdentity) => void;
  /** Drop the account computer and everything fetched from it. */
  closeHost: () => void;
  setDeviceName: (name: string) => Promise<void>;
  unpair: () => void;
  hasControl: () => boolean;
  /** Install a transport someone else built (a huddle guest's), dropping ours. */
  adopt: (transport: Transport | null) => void;
}

/** The connection with no host behind it. */
const DISCONNECTED = {
  identity: null,
  deviceName: "",
  transport: null,
  connection: "offline",
  capabilities: [],
} satisfies Partial<ConnectionState_>;

export const useConnectionStore = create<ConnectionState_>()((set, get) => {
  function connect(identity: DeviceIdentity): Transport {
    const transport = new Transport(credentialsFor(identity), {
      onState: (connection) => {
        set({ connection });
        if (connection === "ready") {
          // Push our display name once the secure channel is up, so the
          // desktop's paired-device list shows a friendly label.
          if (identity.account) {
            // An account device is named on the account.
            identity.account.onReady(transport);
          } else {
            const name = get().deviceName.trim();
            if (name) {
              request(transport, "device.rename", { name }).catch(() => {});
            }
          }
          // Refresh grants: the desktop drops the socket when they change.
          request(transport, "device.capabilities", {})
            .then((r) => set({ capabilities: r.capabilities }))
            .catch(() => {});
          hooks.ready(transport, identity);
        } else {
          hooks.notReady();
        }
      },
      onEvent: (event) => hooks.event(event),
      onMedia: (bytes) => media.push(bytes),
    }, TRANSPORT_OPTIONS);
    transport.connect();

    return transport;
  }

  return {
    ...DISCONNECTED,

    init: () => {
      const identity = loadIdentity();
      if (identity) {
        set({
          identity,
          deviceName: identity.name || defaultDeviceName(),
          capabilities: identity.capabilities,
          transport: connect(identity),
        });
      }
    },

    pairComplete: (identity) => {
      saveIdentity(identity);
      get().transport?.disconnect();
      set({
        identity,
        deviceName: identity.name || defaultDeviceName(),
        capabilities: identity.capabilities,
        transport: connect(identity),
      });
    },

    openAccountHost: (identity) => {
      get().transport?.disconnect();
      hooks.reset();
      set({
        ...DISCONNECTED,
        identity,
        deviceName: identity.name,
        capabilities: [],
        transport: connect(identity),
      });
    },

    closeHost: () => {
      get().transport?.disconnect();
      hooks.reset();
      set(DISCONNECTED);
    },

    setDeviceName: async (rawName) => {
      const name = rawName.trim();
      if (!name) {
        return;
      }
      set({ deviceName: name });
      const identity = get().identity;
      if (identity) {
        const next = { ...identity, name };
        saveIdentity(next);
        set({ identity: next });
      }
      const transport = get().transport;
      if (get().connection === "ready" && transport) {
        await request(transport, "device.rename", { name }).catch(() => {});
      }
    },

    unpair: () => {
      hooks.unpairing(get().transport);
      get().transport?.disconnect();
      clearIdentity();
      hooks.reset();
      set(DISCONNECTED);
    },

    hasControl: () => get().capabilities.includes("control"),

    adopt: (transport) => {
      const current = get().transport;
      if (current && current !== transport) {
        current.disconnect();
      }
      set({ transport });
    },
  };
});

/**
 * Check the socket the moment the tab is visible again or the network is
 * back: it may have died while the tab slept, and a backoff may be counting
 * down. Returns the cleanup.
 */
export function watchLiveness(): () => void {
  const check = () => {
    if (document.visibilityState === "visible") {
      currentTransport()?.checkAlive();
    }
  };
  document.addEventListener("visibilitychange", check);
  window.addEventListener("online", check);

  return () => {
    document.removeEventListener("visibilitychange", check);
    window.removeEventListener("online", check);
  };
}

/** The live transport, or null when there is no host. */
export function currentTransport(): Transport | null {
  return useConnectionStore.getState().transport;
}

/** The live transport when its channel is up. */
export function readyTransport(): Transport | null {
  const { connection, transport } = useConnectionStore.getState();

  return connection === "ready" ? transport : null;
}
