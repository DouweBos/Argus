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
  loading: boolean;
  refresh: () => Promise<void>;
}

// A change landing mid-fetch may not be in that fetch's answer, so it queues
// one more rather than being dropped.
let refreshQueued = false;

const store = create<ClaudeAccountsState>((set, get) => ({
  accounts: [],
  activeId: null,
  loading: false,
  refresh: async () => {
    if (get().loading) {
      refreshQueued = true;

      return;
    }
    set({ loading: true });
    try {
      const state = await listClaudeAccounts();
      set({
        accounts: state.accounts,
        activeId: state.activeId,
      });
    } catch {
      // Keep the last good list; the next event or mount retries.
    } finally {
      set({ loading: false });
    }
    if (refreshQueued) {
      refreshQueued = false;
      await get().refresh();
    }
  },
}));

export function useClaudeAccounts(): {
  accounts: ClaudeAccount[];
  activeId: string | null;
} {
  const accounts = store((s) => s.accounts);
  const activeId = store((s) => s.activeId);
  const refresh = store((s) => s.refresh);
  // Events only arrive while something is mounted, so refetch on every mount.
  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);
  useIpcEvent("claude-auth:accounts-changed", () => {
    refresh().catch(() => undefined);
  });

  return { accounts, activeId };
}

export const refreshClaudeAccounts = (): Promise<void> =>
  store.getState().refresh();
