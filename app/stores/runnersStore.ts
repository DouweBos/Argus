/**
 * Cached list of registered LLM runners.
 *
 * Fetched once via `list_runners` IPC and reused everywhere the picker /
 * settings dialog needs to enumerate runners. The list is effectively
 * static for an app session (runners register at module load on the main
 * side), so a single fetch with a fallback to "claude-code" is plenty.
 */

import type { RegisteredRunner } from "../lib/types";
import { useEffect } from "react";
import { create } from "zustand";
import { listRegisteredRunners } from "../lib/ipc";

interface RunnersState {
  load: () => Promise<void>;
  loaded: boolean;
  loading: boolean;
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
}));

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
