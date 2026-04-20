/**
 * Lightweight persistence for the active route. Stored as a single string
 * via the `ui_state:get` / `ui_state:set` IPC pair, so there's no new
 * backend dependency for a one-line blob.
 */

import { getUiState, setUiState } from "./ipc";

const ROUTE_KEY = "lastRoute";

export async function getPersistedRoute(): Promise<string | null> {
  try {
    return (await getUiState(ROUTE_KEY)) ?? null;
  } catch {
    return null;
  }
}

export function persistRoute(path: string): void {
  setUiState(ROUTE_KEY, path).catch(() => {});
}
