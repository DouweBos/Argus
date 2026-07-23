/**
 * Cached list of signed-in Claude accounts and which one is app-wide active.
 *
 * Unlike the runner list this does change at runtime — signing in, switching,
 * or removing an account — so the store refreshes on the
 * `claude-auth:accounts-changed` event rather than loading exactly once.
 */

import type { ClaudeAccount } from "../lib/types";
import { useEffect } from "react";
import { create } from "zustand";
import { useIpcEvent } from "../hooks/useIpcEvent";
import { listClaudeAccounts } from "../lib/ipc";

interface ClaudeAccountsState {
  accounts: ClaudeAccount[];
  activeId: string | null;
  loaded: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
}

const store = create<ClaudeAccountsState>((set, get) => ({
  accounts: [],
  activeId: null,
  loaded: false,
  loading: false,
  refresh: async () => {
    if (get().loading) {
      return;
    }
    set({ loading: true });
    try {
      const state = await listClaudeAccounts();
      set({
        accounts: state.accounts,
        activeId: state.activeId,
        loaded: true,
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },
}));

export function useClaudeAccounts(): {
  accounts: ClaudeAccount[];
  activeId: string | null;
} {
  const accounts = store((s) => s.accounts);
  const activeId = store((s) => s.activeId);
  const loaded = store((s) => s.loaded);
  const refresh = store((s) => s.refresh);
  useEffect(() => {
    if (!loaded) {
      refresh().catch(() => undefined);
    }
  }, [loaded, refresh]);
  useIpcEvent("claude-auth:accounts-changed", () => {
    refresh().catch(() => undefined);
  });

  return { accounts, activeId };
}

export const refreshClaudeAccounts = (): Promise<void> =>
  store.getState().refresh();
