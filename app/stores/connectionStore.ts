/**
 * Every host the UI is attached to, and how each one is doing.
 *
 * Several can be live at once — this Mac plus a Mac mini for iOS plus a Linux
 * box for Android — so this is a registry, not a single active connection.
 * Which host a given view *reads from* is the route's business
 * (`ParsedRoute.hostId`); this store only knows who is attached and whether
 * their socket is up.
 */

import type { ConnectionState } from "@argus/remote-client";
import { create } from "zustand";
import { useRouteHostId } from "../lib/routeHooks";
import { appNavigate, getCurrentRoute } from "../lib/router";
import { LOCAL_HOST_ID, type HostId } from "../lib/transport/hostId";

export type ConnectionMode = "local" | "remote";

export interface HostConnectionInfo {
  /** When the host was attached in this window. */
  attachedAt: number;
  hostId: HostId;
  /** True once a snapshot has been pulled from this host in this attachment. */
  hydrated: boolean;
  label: string;
  lastError: string | null;
  mode: ConnectionMode;
  state: ConnectionState;
}

interface ConnectionStoreData {
  connections: Record<HostId, HostConnectionInfo>;
  /** Hosts whose saved attachment could not be restored at launch. */
  unreachable: string[];
}

const localConnection: HostConnectionInfo = {
  hostId: LOCAL_HOST_ID,
  label: "This Mac",
  mode: "local",
  state: "ready",
  hydrated: true,
  lastError: null,
  attachedAt: 0,
};

const store = create<ConnectionStoreData>(() => ({
  connections: { [LOCAL_HOST_ID]: localConnection },
  unreachable: [],
}));

export const getConnections = (): HostConnectionInfo[] =>
  Object.values(store.getState().connections);

export const getHostConnection = (hostId: HostId): HostConnectionInfo | null =>
  store.getState().connections[hostId] ?? null;

export const isHostAttached = (hostId: HostId): boolean =>
  store.getState().connections[hostId] !== undefined;

/** Attached hosts, this Mac first and the rest in attachment order. */
export const useHostConnections = (): HostConnectionInfo[] => {
  const connections = store((s) => s.connections);

  return Object.values(connections).sort((a, b) => a.attachedAt - b.attachedAt);
};

export const useHostConnection = (hostId: HostId): HostConnectionInfo | null =>
  store((s) => s.connections[hostId] ?? null);

export const useUnreachableHosts = (): string[] => store((s) => s.unreachable);

export const addHostConnection = (info: HostConnectionInfo): void => {
  store.setState((s) => ({
    connections: { ...s.connections, [info.hostId]: info },
    unreachable: s.unreachable.filter((label) => label !== info.label),
  }));
};

export const setHostConnection = (
  hostId: HostId,
  patch: Partial<HostConnectionInfo>,
): void => {
  store.setState((s) => {
    const existing = s.connections[hostId];
    if (!existing) {
      return s;
    }

    return {
      connections: { ...s.connections, [hostId]: { ...existing, ...patch } },
    };
  });
};

export const removeHostConnection = (hostId: HostId): void => {
  if (hostId === LOCAL_HOST_ID) {
    return;
  }
  store.setState((s) => ({
    connections: Object.fromEntries(
      Object.entries(s.connections).filter(([id]) => id !== hostId),
    ),
  }));
};

export const markHostUnreachable = (label: string): void => {
  store.setState((s) => ({
    unreachable: s.unreachable.includes(label)
      ? s.unreachable
      : [...s.unreachable, label],
  }));
};

export const dismissUnreachableHost = (label: string): void => {
  store.setState((s) => ({
    unreachable: s.unreachable.filter((l) => l !== label),
  }));
};

// --- Focus -----------------------------------------------------------------

/**
 * Point the view at a host. Lives in the URL, not here: "which machine am I
 * reading from" is part of what you're looking at, and back/forward should
 * take you between them. Detached hosts fall back to this Mac.
 */
export const setFocusedHost = (hostId: HostId): void => {
  const route = getCurrentRoute();
  if (route.hostId === hostId) {
    return;
  }
  appNavigate({
    ...(isHostAttached(hostId) ? { hostId } : { hostId: LOCAL_HOST_ID }),
    view: "home",
  });
};

/** The host the current view reads from, as a connection record. */
export const useFocusedConnection = (): HostConnectionInfo => {
  const hostId = useRouteHostId();
  const connections = store((s) => s.connections);

  return connections[hostId] ?? connections[LOCAL_HOST_ID] ?? localConnection;
};

export const getFocusedConnection = (): HostConnectionInfo =>
  getHostConnection(getCurrentRoute().hostId) ?? localConnection;

export const useIsRemote = (): boolean =>
  useFocusedConnection().mode === "remote";

/** Label for the machine the current view is driving, for menus and banners. */
export const useConnectionLabel = (): string => useFocusedConnection().label;

/** Test seam. */
export const resetConnections = (): void => {
  store.setState({
    connections: { [LOCAL_HOST_ID]: localConnection },
    unreachable: [],
  });
};
