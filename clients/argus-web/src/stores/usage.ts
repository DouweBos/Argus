/**
 * The computer's Claude plan limits and its token and cost totals. Mirrors
 * `HostStore+UsageLimits` / `+UsageSummary`. The host captures
 * `usage_limits_fetched` and `usage_summary_loaded` itself.
 */

import { create } from "zustand";
import {
  describeError,
  INITIAL_LOAD,
  isQuietError,
  type LoadState,
} from "@argus/client-core";
import type {
  ClaudeUsageLimits,
  ClaudeUsageSummary,
  UsageRange,
} from "@argus/remote-protocol";
import { request } from "../lib/request";
import { currentTransport } from "./connection";

/** Asking Claude for limits can take a while; the phone allows as long. */
export const USAGE_LIMITS_TIMEOUT_MS = 30_000;

interface Load {
  background?: boolean;
  /** Skip the host's minute-long cache. */
  force?: boolean;
}

interface UsageState {
  limits: ClaudeUsageLimits | null;
  limitsLoad: LoadState;
  /** When the last limits answer landed; countdowns are measured from it. */
  limitsAt: number;
  limitsRefreshing: boolean;
  /** Per range, so switching back shows the last answer at once. */
  summaries: Partial<Record<UsageRange, ClaudeUsageSummary>>;
  summaryLoad: Partial<Record<UsageRange, LoadState>>;
  summaryRefreshing: boolean;

  loadLimits: (options?: Load) => Promise<void>;
  loadSummary: (range: UsageRange, options?: Load) => Promise<void>;
}

const EMPTY = {
  limits: null,
  limitsLoad: INITIAL_LOAD,
  limitsAt: 0,
  limitsRefreshing: false,
  summaries: {},
  summaryLoad: {},
  summaryRefreshing: false,
} satisfies Partial<UsageState>;

/** The newest summary request per range wins over a slower, older one. */
const summaryTickets: Partial<Record<UsageRange, number>> = {};

export const useUsageStore = create<UsageState>()((set) => ({
  ...EMPTY,

  loadLimits: async ({ background = false, force = false } = {}) => {
    const transport = currentTransport();
    if (!transport) {
      return;
    }
    if (!background) {
      set({ limitsRefreshing: true });
    }
    try {
      const limits = await request(
        transport,
        "usage.limits",
        force ? { refresh: true } : {},
        { timeoutMs: USAGE_LIMITS_TIMEOUT_MS, background },
      );
      set({
        limits,
        limitsLoad: { loaded: true, error: null },
        limitsAt: Date.now(),
      });
    } catch (err) {
      if (!isQuietError(err, background)) {
        set((s) => ({
          limitsLoad: { loaded: true, error: describeError(err) },
          limitsAt: s.limitsAt || Date.now(),
        }));
      }
    } finally {
      set({ limitsRefreshing: false });
    }
  },

  loadSummary: async (range, { background = false } = {}) => {
    const transport = currentTransport();
    if (!transport) {
      return;
    }
    const ticket = (summaryTickets[range] ?? 0) + 1;
    summaryTickets[range] = ticket;
    if (!background) {
      set({ summaryRefreshing: true });
    }
    try {
      const summary = await request(
        transport,
        "usage.summary",
        { range },
        { background },
      );
      if (summaryTickets[range] === ticket) {
        set((s) => ({
          summaries: { ...s.summaries, [range]: summary },
          summaryLoad: {
            ...s.summaryLoad,
            [range]: { loaded: true, error: null },
          },
        }));
      }
    } catch (err) {
      if (summaryTickets[range] === ticket && !isQuietError(err, background)) {
        set((s) => ({
          summaryLoad: {
            ...s.summaryLoad,
            [range]: { loaded: true, error: describeError(err) },
          },
        }));
      }
    } finally {
      set({ summaryRefreshing: false });
    }
  },
}));

export function resetUsage(): void {
  useUsageStore.setState(EMPTY);
}
