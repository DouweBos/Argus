/**
 * The connected computer's automations and their runs.
 *
 * Its own store rather than a slice of `appStore`: this is host state that
 * only three screens read, and it borrows the live Transport instead of owning
 * one. Like every other list on this client there is no push channel, so the
 * screens poll with `useLiveRefresh`.
 *
 * Everything is dropped when the active computer changes — automations belong
 * to the machine that runs the clock, and two computers never share them.
 */

import { create } from "zustand";
import type {
  RemoteAutomation,
  RemoteAutomationRun,
  RemoteAutomationRunDetail,
} from "../lib/protocol";
import { useAppStore } from "./appStore";

interface AutomationsState {
  automations: RemoteAutomation[];
  /** Every run the computer handed over, newest first, across automations. */
  runs: RemoteAutomationRun[];
  /** Run detail (with its report) by run id, fetched when one is opened. */
  detailByRun: Record<string, RemoteAutomationRunDetail>;
  /** Runs this client just asked for, so the row reacts before the poll does. */
  triggering: Record<string, true>;
  /** Set when the computer refused — usually a missing `control` grant. */
  error: string | null;
  loaded: boolean;

  clear: () => void;
  refresh: () => Promise<void>;
  loadRun: (runId: string) => Promise<void>;
  /** Reading a report clears it on the computer too — there is one inbox. */
  markRunRead: (runId: string) => Promise<void>;
  runNow: (automationId: string) => Promise<void>;
  cancelRun: (runId: string) => Promise<void>;
}

const message = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export const useAutomationsStore = create<AutomationsState>((set, get) => ({
  automations: [],
  runs: [],
  detailByRun: {},
  triggering: {},
  error: null,
  loaded: false,

  clear: () =>
    set({
      automations: [],
      runs: [],
      detailByRun: {},
      triggering: {},
      error: null,
      loaded: false,
    }),

  refresh: async () => {
    const t = useAppStore.getState().transport;
    if (!t) {
      return;
    }
    try {
      const [{ automations }, { runs }] = await Promise.all([
        t.request<{ automations: RemoteAutomation[] }>("automations.list", {}),
        t.request<{ runs: RemoteAutomationRun[] }>("automations.runs", {
          limit: 40,
        }),
      ]);
      // A run that finished between the poll and now clears its pending flag.
      const triggering = { ...get().triggering };
      for (const run of runs) {
        delete triggering[run.automation_id];
      }
      set({ automations, runs, triggering, error: null, loaded: true });
    } catch (err) {
      set({ error: message(err), loaded: true });
    }
  },

  loadRun: async (runId) => {
    const t = useAppStore.getState().transport;
    if (!t) {
      return;
    }
    try {
      const detail = await t.request<RemoteAutomationRunDetail>(
        "automations.run",
        { run_id: runId },
      );
      set((s) => ({ detailByRun: { ...s.detailByRun, [runId]: detail } }));
    } catch (err) {
      set({ error: message(err) });
    }
  },

  markRunRead: async (runId) => {
    const t = useAppStore.getState().transport;
    if (!t) {
      return;
    }
    try {
      const { run } = await t.request<{ run: RemoteAutomationRun }>(
        "automations.mark_run_read",
        { run_id: runId },
      );
      set((s) => ({
        runs: s.runs.map((r) => (r.id === run.id ? run : r)),
        detailByRun: s.detailByRun[runId]
          ? { ...s.detailByRun, [runId]: { ...s.detailByRun[runId], run } }
          : s.detailByRun,
      }));
    } catch {
      // Losing a read receipt is not worth a banner — the next open retries.
    }
  },

  runNow: async (automationId) => {
    const t = useAppStore.getState().transport;
    if (!t) {
      return;
    }
    set((s) => ({ triggering: { ...s.triggering, [automationId]: true } }));
    try {
      const { run } = await t.request<{ run: RemoteAutomationRun }>(
        "automations.run_now",
        { automation_id: automationId },
      );
      // A run that could not start comes back as a `skipped` record with the
      // reason on it, so it belongs in the list like any other.
      set((s) => ({ runs: [run, ...s.runs], error: null }));
    } catch (err) {
      set((s) => {
        const triggering = { ...s.triggering };
        delete triggering[automationId];

        return { triggering, error: message(err) };
      });
    }
    await get().refresh();
  },

  cancelRun: async (runId) => {
    const t = useAppStore.getState().transport;
    if (!t) {
      return;
    }
    try {
      await t.request("automations.cancel_run", { run_id: runId });
    } catch (err) {
      set({ error: message(err) });
    }
    await get().refresh();
  },
}));

/** Whether a run is still going — the only state a cancel button cares about. */
export function isRunActive(run: RemoteAutomationRun): boolean {
  return run.status === "queued" || run.status === "running";
}

/**
 * Drop everything when the phone switches computers. Subscribing here rather
 * than clearing from `appStore` keeps the dependency one-way — this store
 * knows about the app store, never the other way round.
 */
useAppStore.subscribe((state, previous) => {
  if (state.activeHostId !== previous.activeHostId) {
    useAutomationsStore.getState().clear();
  }
});
