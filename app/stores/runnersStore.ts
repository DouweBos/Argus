/**
 * Cached list of registered LLM runners.
 *
 * Fetched once via `list_runners` IPC and reused everywhere the picker /
 * settings dialog needs to enumerate runners. Built-ins register at module
 * load on the main side, so one fetch is enough; editing a custom runner
 * calls {@link reloadRegisteredRunners} to pick up the change.
 */

import type { RegisteredRunner } from "../lib/types";
import { useEffect } from "react";
import { create } from "zustand";
import { listRegisteredRunners } from "../lib/ipc";

interface RunnersState {
  load: () => Promise<void>;
  loaded: boolean;
  loading: boolean;
  /** Re-fetch after custom runners change. */
  reload: () => Promise<void>;
  runners: RegisteredRunner[];
}

const store = create<RunnersState>((set, get) => ({
  runners: [],
  loaded: false,
  loading: false,
  load: async () => {
    if (get().loaded || get().loading) {
      return;
    }
    set({ loading: true });
    try {
      const runners = await listRegisteredRunners();
      set({ runners, loaded: true, loading: false });
    } catch {
      set({ loading: false });
    }
  },
  reload: async () => {
    try {
      set({ runners: await listRegisteredRunners(), loaded: true });
    } catch {
      // Keep the previous list; the next load retries.
    }
  },
}));

/** Re-fetch the registry, e.g. after a custom runner is saved or deleted. */
export const reloadRegisteredRunners = (): Promise<void> =>
  store.getState().reload();

/**
 * Hook that ensures the runner list has been fetched and returns the
 * cached value. Components can call this freely; the IPC happens at most
 * once per app session.
 */
export function useRegisteredRunners(): RegisteredRunner[] {
  const runners = store((s) => s.runners);
  const load = store((s) => s.load);
  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  return runners;
}

export const getRegisteredRunners = (): RegisteredRunner[] =>
  store.getState().runners;
