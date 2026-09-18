/**
 * Automations + their runs, as the focused host sees them.
 *
 * Host state, not renderer state: the backend owns the list and pushes every
 * change on `automations:changed` / `automation_run:changed`, so nothing here
 * polls. Navigation helpers write to the URL — which automation and which run
 * you are looking at is the route, never a slice in here.
 */

import type { HostId } from "../lib/transport/hostId";
import type { Automation, AutomationRun } from "../lib/types";
import { useEffect } from "react";
import { create } from "zustand";
import { useIpcEvent } from "../hooks/useIpcEvent";
import {
  cancelAutomationRun as cancelAutomationRunIpc,
  createAutomation as createAutomationIpc,
  deleteAutomation as deleteAutomationIpc,
  listAutomationRuns,
  listAutomations,
  runAutomationNow as runAutomationNowIpc,
  setAutomationEnabled as setAutomationEnabledIpc,
  updateAutomation as updateAutomationIpc,
} from "../lib/ipc";
import { useRouteHostId } from "../lib/routeHooks";
import { appNavigate } from "../lib/router";

interface AutomationStoreData {
  automations: Automation[];
  error: string | null;
  loading: boolean;
  runs: AutomationRun[];
}

const store = create<AutomationStoreData>(() => ({
  automations: [],
  runs: [],
  loading: false,
  error: null,
}));

function byNewest(runs: AutomationRun[]): AutomationRun[] {
  return [...runs].sort((a, b) => b.started_at - a.started_at);
}

/** Replace the whole list — the payload of `automations:changed`. */
export function applyAutomationsChanged(automations: Automation[]): void {
  store.setState({ automations });
}

/**
 * Fold one run into the cache. `null` means a bulk delete happened, so the
 * cache is dropped and refetched rather than guessed at.
 */
export function applyRunChanged(run: AutomationRun | null): void {
  if (!run) {
    refreshRuns().catch(() => undefined);

    return;
  }
  const runs = store.getState().runs;
  const index = runs.findIndex((r) => r.id === run.id);
  const next = index === -1 ? [run, ...runs] : runs.with(index, run);
  store.setState({ runs: byNewest(next) });
}

async function refreshRuns(): Promise<void> {
  try {
    store.setState({ runs: byNewest(await listAutomationRuns()) });
  } catch {
    // A refresh failure leaves the last known runs on screen; the next event
    // corrects it.
  }
}

/** Load automations + runs from a host. Safe to call repeatedly. */
export async function refreshAutomations(): Promise<void> {
  store.setState({ loading: true, error: null });
  try {
    const [automations, runs] = await Promise.all([
      listAutomations(),
      listAutomationRuns(),
    ]);
    store.setState({
      automations,
      runs: byNewest(runs),
      loading: false,
      error: null,
    });
  } catch (e) {
    store.setState({
      loading: false,
      error: typeof e === "string" ? e : String(e),
    });
  }
}

/**
 * Keep the cache in step with the focused host. Mounted once in the app shell
 * so a run started on the automations screen keeps progressing while you are
 * somewhere else.
 */
export function useAutomationsSync(): void {
  const hostId = useRouteHostId();

  useEffect(() => {
    store.setState({ automations: [], runs: [] });
    refreshAutomations().catch(() => undefined);
  }, [hostId]);

  useIpcEvent<Automation[]>(
    "automations:changed",
    applyAutomationsChanged,
    hostId,
  );
  useIpcEvent<AutomationRun | null>(
    "automation_run:changed",
    applyRunChanged,
    hostId,
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const useAutomations = (): Automation[] => store((s) => s.automations);

export const useAutomationsLoading = (): boolean => store((s) => s.loading);

export const useAutomationsError = (): string | null => store((s) => s.error);

export const useAutomation = (id: string | null): Automation | null =>
  store((s) => (id ? (s.automations.find((a) => a.id === id) ?? null) : null));

export const useAutomationRun = (runId: string | null): AutomationRun | null =>
  store((s) => (runId ? (s.runs.find((r) => r.id === runId) ?? null) : null));

/** Every run of one automation, newest first. */
export const useAutomationRuns = (automationId: string | null) =>
  store((s) =>
    automationId ? s.runs.filter((r) => r.automation_id === automationId) : [],
  );

/** Every cached run, newest first — the inbox needs them across automations. */
export const useAllRuns = (): AutomationRun[] => store((s) => s.runs);

/** The newest run of an automation, whatever its status. */
export const useLatestRun = (automationId: string): AutomationRun | null =>
  store((s) => s.runs.find((r) => r.automation_id === automationId) ?? null);

/** Whether an automation has a run in flight — a second one cannot start. */
export const useHasActiveRun = (automationId: string): boolean =>
  store((s) =>
    s.runs.some(
      (r) =>
        r.automation_id === automationId &&
        (r.status === "queued" || r.status === "running"),
    ),
  );

/** For tests. */
export const getAutomationState = () => store.getState();
export const setAutomationState = store.setState.bind(store);

// ---------------------------------------------------------------------------
// Writes — the backend emits, so none of these patch the cache by hand.
// ---------------------------------------------------------------------------

export const setAutomationEnabled = (
  id: string,
  enabled: boolean,
): Promise<Automation> => setAutomationEnabledIpc(id, enabled);

export const saveAutomation = updateAutomationIpc;

export const createAutomation = createAutomationIpc;

export const deleteAutomation = deleteAutomationIpc;

export const runAutomationNow = runAutomationNowIpc;

export const cancelAutomationRun = cancelAutomationRunIpc;

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export function openAutomations(hostId?: HostId): void {
  appNavigate({ view: "automations", ...(hostId ? { hostId } : {}) });
}

export function openAutomation(automationId: string): void {
  appNavigate({ view: "automations", automationId, automationRunId: null });
}

export function openAutomationRun(automationId: string, runId: string): void {
  appNavigate({
    view: "automations",
    automationId,
    automationRunId: runId,
  });
}
