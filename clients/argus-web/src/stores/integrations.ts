/**
 * Which integrations the computer has connected, and as whom. A key typed here
 * goes to the computer's secret store and never comes back.
 */

import { create } from "zustand";
import {
  describeError,
  INITIAL_LOAD,
  isQuietError,
  type LoadState,
} from "@argus/client-core";
import type { IntegrationId, IntegrationStatus } from "@argus/remote-protocol";
import { request } from "../lib/request";
import { currentTransport } from "./connection";

interface IntegrationsState {
  integrations: IntegrationStatus[];
  integrationsLoad: LoadState;
  /** `background` for polls and resumes: a dropped connection stays quiet. */
  refreshIntegrations: (options?: { background?: boolean }) => Promise<void>;
  /** Throws the computer's sentence, e.g. that the service rejected the key. */
  connectIntegration: (id: IntegrationId, key: string) => Promise<void>;
  disconnectIntegration: (id: IntegrationId) => Promise<void>;
}

function replaced(
  list: IntegrationStatus[],
  next: IntegrationStatus,
): IntegrationStatus[] {
  return list.some((i) => i.id === next.id)
    ? list.map((i) => (i.id === next.id ? next : i))
    : [...list, next];
}

export const useIntegrationsStore = create<IntegrationsState>()((set, get) => ({
  integrations: [],
  integrationsLoad: INITIAL_LOAD,

  refreshIntegrations: async (options) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    try {
      const { integrations } = await request(t, "integrations.list", {});
      set({ integrations, integrationsLoad: { loaded: true, error: null } });
    } catch (err) {
      // An older computer has no integrations to offer.
      if (!isQuietError(err, options?.background ?? false)) {
        set({
          integrations: [],
          integrationsLoad: { loaded: true, error: describeError(err) },
        });
      }
    }
  },

  connectIntegration: async (id, key) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    const { integration } = await request(t, "integrations.connect_key", {
      id,
      key: key.trim(),
    });
    set({ integrations: replaced(get().integrations, integration) });
  },

  disconnectIntegration: async (id) => {
    const t = currentTransport();
    if (!t) {
      return;
    }
    const { integration } = await request(t, "integrations.disconnect", { id });
    set({ integrations: replaced(get().integrations, integration) });
  },
}));

/** Linear is connected and its credential still works. */
export function linearConnected(integrations: IntegrationStatus[]): boolean {
  return integrations.some(
    (i) => i.id === "linear" && i.connected && !i.needsReauth,
  );
}

/** A new host: its integrations aren't the last one's. */
export function resetIntegrations(): void {
  useIntegrationsStore.setState({
    integrations: [],
    integrationsLoad: INITIAL_LOAD,
  });
}
