/**
 * The account computers' online state, keyed by their Noise key so a QR
 * pairing to the same computer shows it too. Shared by every host list; each
 * list keeps it fresh with `useAccountPresence`, and fetches are deduped.
 */

import type { PresenceInfo } from "../lib/accountPresence";
import type { AccountHost } from "../lib/types";
import { create } from "zustand";
import { useLiveRefresh } from "../hooks/useLiveRefresh";
import { accountListHosts } from "../lib/ipc";

/** Matches the phone and the Mac app: well inside the 15-minute online window. */
export const PRESENCE_POLL_MS = 60_000;
/** Several lists mounting at once share one fetch. */
const MIN_REFETCH_MS = 15_000;

interface AccountPresenceState {
  byNoisePub: Record<string, PresenceInfo>;
  fetchedAt: number;
}

export const useAccountPresenceStore = create<AccountPresenceState>()(() => ({
  byNoisePub: {},
  fetchedAt: 0,
}));

/** Fold freshly listed account computers into the shared presence. */
export function setAccountPresence(hosts: AccountHost[]): void {
  useAccountPresenceStore.setState({
    fetchedAt: Date.now(),
    byNoisePub: Object.fromEntries(
      hosts.map((h) => [
        h.noise_pub,
        { online: h.online, last_seen: h.last_seen },
      ]),
    ),
  });
}

export async function refreshAccountPresence(): Promise<void> {
  if (
    Date.now() - useAccountPresenceStore.getState().fetchedAt <
    MIN_REFETCH_MS
  ) {
    return;
  }
  useAccountPresenceStore.setState({ fetchedAt: Date.now() });
  setAccountPresence(await accountListHosts().catch(() => []));
}

/** Presence by host Noise key, re-read every minute while a host list is up. */
export function useAccountPresence(): Record<string, PresenceInfo> {
  useLiveRefresh(() => {
    refreshAccountPresence().catch(() => undefined);
  }, PRESENCE_POLL_MS);

  return useAccountPresenceStore((s) => s.byNoisePub);
}
