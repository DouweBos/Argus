/**
 * Which integrations the computer has connected, and as whom. Read-only:
 * connecting one takes a secret, which stays on the computer.
 */

import { create } from "zustand";
import {
  describeError,
  INITIAL_LOAD,
  isQuietError,
  type LoadState,
} from "@argus/client-core";
import type { IntegrationStatus } from "@argus/remote-protocol";
import { request } from "../lib/request";
import { currentTransport } from "./connection";

interface IntegrationsState {
  integrations: IntegrationStatus[];
  integrationsLoad: LoadState;
  /** `background` for polls and resumes: a dropped connection stays quiet. */
  refreshIntegrations: (options?: { background?: boolean }) => Promise<void>;
}

export const useIntegrationsStore = create<IntegrationsState>()((set) => ({
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
