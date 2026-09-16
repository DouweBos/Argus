/**
 * Which machine the UI is driving, and how that connection is doing.
 *
 * Transport state, not route state — the URL says what you are looking at, not
 * where it runs. Kept in a store (rather than the route) so a shared link can
 * never strand someone on a machine they cannot reach.
 */

import type { ConnectionState } from "@argus/remote-client";
import { create } from "zustand";

export type ConnectionMode = "local" | "remote";

export interface ConnectionInfo {
  /** Set when a saved host could not be reached and we booted local instead. */
  fallbackFrom: string | null;
  hostId: string | null;
  hostLabel: string | null;
  /** True once a snapshot has been pulled from the host in this attachment. */
  hydrated: boolean;
  lastError: string | null;
  mode: ConnectionMode;
  state: ConnectionState;
}

const store = create<ConnectionInfo>(() => ({
  mode: "local",
  hostId: null,
  hostLabel: null,
  state: "ready",
  hydrated: true,
  lastError: null,
  fallbackFrom: null,
}));

export const useConnection = (): ConnectionInfo => store();
export const getConnection = (): ConnectionInfo => store.getState();

export const setConnectionInfo = (patch: Partial<ConnectionInfo>): void => {
  store.setState(patch);
};

export const useIsRemote = (): boolean => store((s) => s.mode === "remote");

/** Label for the machine the UI is driving, for menus and banners. */
export const useConnectionLabel = (): string =>
  store((s) => (s.mode === "local" ? "This Mac" : (s.hostLabel ?? "Host")));
