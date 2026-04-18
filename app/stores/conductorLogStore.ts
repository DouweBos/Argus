import type { ConductorLogEntry } from "../lib/types";
import { useEffect } from "react";
import { create } from "zustand";
import { listConductorLogs } from "../lib/ipc";

let initialized = false;

/**
 * Subscribe once to the backend `conductor:log` stream and append each entry
 * into the per-device buffer. Call from app init.
 */
export function initConductorLogListener(): void {
  if (initialized) {
    return;
  }
  initialized = true;
  window.argus.on<ConductorLogEntry>("conductor:log", (entry) => {
    appendConductorLog(entry);
  });
}

const MAX_PER_DEVICE = 500;

interface ConductorLogData {
  /** Entries keyed by deviceKey. */
  byDevice: Record<string, ConductorLogEntry[]>;
}

const conductorLogStore = create<ConductorLogData>(() => ({
  byDevice: {},
}));

export const appendConductorLog = (entry: ConductorLogEntry): void => {
  conductorLogStore.setState((state) => {
    const prev = state.byDevice[entry.deviceKey] ?? [];
    const next = [...prev, entry];
    if (next.length > MAX_PER_DEVICE) {
      next.splice(0, next.length - MAX_PER_DEVICE);
    }

    return {
      byDevice: { ...state.byDevice, [entry.deviceKey]: next },
    };
  });
};

export const setConductorLogsForDevice = (
  deviceKey: string,
  entries: ConductorLogEntry[],
): void => {
  conductorLogStore.setState((state) => ({
    byDevice: { ...state.byDevice, [deviceKey]: entries },
  }));
};

const EMPTY_LOGS: ConductorLogEntry[] = [];

export const useConductorLogs = (
  deviceKey: string | null,
): ConductorLogEntry[] =>
  conductorLogStore((s) =>
    deviceKey ? (s.byDevice[deviceKey] ?? EMPTY_LOGS) : EMPTY_LOGS,
  );

/** Initial-fetch helper — call when opening a device view. */
export function useInitialConductorLogs(deviceKey: string | null): void {
  useEffect(() => {
    if (!deviceKey) {
      return;
    }
    listConductorLogs(deviceKey)
      .then((entries) => setConductorLogsForDevice(deviceKey, entries))
      .catch(() => {});
  }, [deviceKey]);
}
