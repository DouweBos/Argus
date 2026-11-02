/**
 * What agents started from this browser begin with, as the phone's
 * Settings → Agents. Kept in this browser only; null follows the computer.
 */

import { create } from "zustand";
import type { RemotePermissionMode } from "./protocol";

const MODE_KEY = "argus.agents.defaultMode";

/** The modes a remote may start an agent in: never Trusted. */
export const START_MODES: readonly RemotePermissionMode[] = [
  "auto",
  "ask",
  "plan",
  "review",

];

function readMode(): RemotePermissionMode | null {
  try {
    const raw = localStorage.getItem(MODE_KEY);

    return START_MODES.find((m) => m === raw) ?? null;
  } catch {
    return null;
  }
}

const store = create<{ mode: RemotePermissionMode | null }>(() => ({
  mode: readMode(),
}));

export function defaultPermissionMode(): RemotePermissionMode | null {
  return store.getState().mode;
}

export const useDefaultPermissionMode = () => store((s) => s.mode);

export function setDefaultPermissionMode(
  mode: RemotePermissionMode | null,
): void {
  store.setState({ mode });
  try {
    if (mode) {
      localStorage.setItem(MODE_KEY, mode);
    } else {
      localStorage.removeItem(MODE_KEY);
    }
  } catch {
    // storage unavailable — this visit only
  }
}
