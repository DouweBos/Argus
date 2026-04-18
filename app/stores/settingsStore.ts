import { create } from "zustand";

export type PermissionMode =
  | "acceptEdits"
  | "bypassPermissions"
  | "default"
  | "plan";

export const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  default: "Default (ask before each tool)",
  acceptEdits: "Accept edits automatically",
  plan: "Plan mode",
  bypassPermissions: "Bypass permissions (yolo)",
};

interface SettingsState {
  defaultPermissionMode: PermissionMode;
}

const STORAGE_KEY = "argus:settings";

function load(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SettingsState>;

      return {
        defaultPermissionMode:
          parsed.defaultPermissionMode === "acceptEdits" ||
          parsed.defaultPermissionMode === "plan" ||
          parsed.defaultPermissionMode === "bypassPermissions"
            ? parsed.defaultPermissionMode
            : "default",
      };
    }
  } catch {
    // fall through to defaults
  }

  return { defaultPermissionMode: "default" };
}

function persist(state: SettingsState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable
  }
}

const store = create<SettingsState>(() => load());

export const setDefaultPermissionMode = (mode: PermissionMode) => {
  store.setState({ defaultPermissionMode: mode });
  persist(store.getState());
};

export const useDefaultPermissionMode = () =>
  store((s) => s.defaultPermissionMode);

export const getDefaultPermissionMode = () =>
  store.getState().defaultPermissionMode;

interface SettingsDialogState {
  open: boolean;
}

const dialogStore = create<SettingsDialogState>(() => ({ open: false }));

export const showSettingsDialog = () => dialogStore.setState({ open: true });
export const hideSettingsDialog = () => dialogStore.setState({ open: false });
export const useSettingsDialogOpen = () => dialogStore((s) => s.open);
