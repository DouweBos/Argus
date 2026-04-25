/**
 * Renderer-side mirror of the main process updater state. The main process
 * pushes a fresh snapshot on every electron-updater event via the
 * `updater:state` channel; we hydrate once at startup and then keep the
 * mirror in sync from those events.
 */

import { create } from "zustand";
import {
  updaterCheck,
  updaterDownload,
  updaterGetState,
  updaterQuitAndInstall,
  type UpdaterState,
} from "../lib/ipc";

const initialState: UpdaterState = {
  currentVersion: "",
  error: null,
  phase: "idle",
  progressPercent: 0,
  releaseNotes: null,
  releaseDate: null,
  updateVersion: null,
  lastCheckedAt: null,
};

interface UiState {
  /** Whether the changelog dialog is currently open. */
  changelogDialogOpen: boolean;
  /** Whether the user has dismissed the "ready, restart now?" prompt for the
   *  current downloaded version. Reset when a new version arrives. */
  installPromptDismissedFor: string | null;
}

interface Store {
  state: UpdaterState;
  ui: UiState;
}

const store = create<Store>(() => ({
  state: initialState,
  ui: { changelogDialogOpen: false, installPromptDismissedFor: null },
}));

let initialized = false;

/** Subscribe to backend updater events. Idempotent; safe to call from any mount. */
export function initUpdaterStore(): void {
  if (initialized) {
    return;
  }
  initialized = true;
  updaterGetState()
    .then((s) => store.setState({ state: s }))
    .catch(() => {});
  window.argus.on<UpdaterState>("updater:state", (next) => {
    const prev = store.getState().state;
    store.setState({
      state: next,
      ui: {
        ...store.getState().ui,
        // A new download invalidates a previous "Later" choice so the prompt
        // can resurface for the new version.
        installPromptDismissedFor:
          prev.updateVersion !== next.updateVersion
            ? null
            : store.getState().ui.installPromptDismissedFor,
      },
    });
  });
  window.argus.on<{ id: string }>("menu:invoke-shortcut", (payload) => {
    if (payload?.id === "updater-show") {
      openChangelogDialog();
    }
  });
}

export const useUpdaterState = (): UpdaterState => store((s) => s.state);

export const useUpdaterUi = (): UiState => store((s) => s.ui);

export function openChangelogDialog(): void {
  store.setState((s) => ({ ui: { ...s.ui, changelogDialogOpen: true } }));
}

export function closeChangelogDialog(): void {
  store.setState((s) => ({ ui: { ...s.ui, changelogDialogOpen: false } }));
}

export function dismissInstallPrompt(): void {
  const v = store.getState().state.updateVersion;
  store.setState((s) => ({
    ui: { ...s.ui, installPromptDismissedFor: v },
  }));
}

export async function checkNow(): Promise<void> {
  await updaterCheck(false);
}

export async function downloadNow(): Promise<void> {
  await updaterDownload();
}

export async function quitAndInstall(): Promise<void> {
  await updaterQuitAndInstall();
}
