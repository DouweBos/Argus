import type { ClaudeUsageLimits } from "../../lib/types";
import { useEffect } from "react";
import { create } from "zustand";
import { getClaudeUsageLimits } from "../../lib/ipc";

const POLL_MS = 60_000;

export interface UsageLimitsState {
  data: ClaudeUsageLimits | null;
  error: string | null;
  loading: boolean;
  /** When the last answer landed; reset countdowns are measured from it. */
  now: number;
  refresh: () => void;
  refreshing: boolean;
}

const store = create<UsageLimitsState>(() => ({
  data: null,
  error: null,
  loading: true,
  now: Date.now(),
  refresh: () => {
    store.setState({ refreshing: true });
    load(true);
  },
  refreshing: false,
}));

function load(force: boolean): void {
  getClaudeUsageLimits(force)
    .then((data) => store.setState({ data, error: null }))
    .catch((e: unknown) => store.setState({ error: String(e) }))
    .finally(() =>
      store.setState({ now: Date.now(), loading: false, refreshing: false }),
    );
}

// One poll however many screens show limits; it stops with the last of them.
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(): () => void {
  subscribers += 1;
  if (subscribers === 1) {
    load(false);
    timer = setInterval(() => load(false), POLL_MS);
  }

  return () => {
    subscribers -= 1;
    if (subscribers === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Plan limits, polled every minute while anything shows them (the host caches as long). */
export function useUsageLimits(): UsageLimitsState {
  useEffect(subscribe, []);

  return store();
}
