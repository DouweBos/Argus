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

export interface CustomEditor {
  command: string;
  id: string;
  name: string;
}

interface SettingsState {
  customEditors: CustomEditor[];
  defaultPermissionMode: PermissionMode;
}

const STORAGE_KEY = "argus:settings";

function sanitizeCustomEditors(input: unknown): CustomEditor[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.flatMap((raw): CustomEditor[] => {
    if (!raw || typeof raw !== "object") {
      return [];
    }
    const obj = raw as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id : null;
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    const command = typeof obj.command === "string" ? obj.command.trim() : "";
    if (!id || !name || !command) {
      return [];
    }

    return [{ id, name, command }];
  });
}

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
        customEditors: sanitizeCustomEditors(parsed.customEditors),
      };
    }
  } catch {
    // fall through to defaults
  }

  return { defaultPermissionMode: "default", customEditors: [] };
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

export const useCustomEditors = () => store((s) => s.customEditors);

export const addCustomEditor = (name: string, command: string): void => {
  const trimmedName = name.trim();
  const trimmedCommand = command.trim();
  if (!trimmedName || !trimmedCommand) {
    return;
  }
  const next: CustomEditor = {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmedName,
    command: trimmedCommand,
  };
  store.setState((s) => ({ customEditors: [...s.customEditors, next] }));
  persist(store.getState());
};

export const updateCustomEditor = (
  id: string,
  patch: { command?: string; name?: string },
): void => {
  store.setState((s) => ({
    customEditors: s.customEditors.map((e) =>
      e.id === id
        ? {
            ...e,
            name:
              patch.name !== undefined ? patch.name.trim() || e.name : e.name,
            command:
              patch.command !== undefined
                ? patch.command.trim() || e.command
                : e.command,
          }
        : e,
    ),
  }));
  persist(store.getState());
};

export const removeCustomEditor = (id: string): void => {
  store.setState((s) => ({
    customEditors: s.customEditors.filter((e) => e.id !== id),
  }));
  persist(store.getState());
};

interface SettingsDialogState {
  open: boolean;
}

const dialogStore = create<SettingsDialogState>(() => ({ open: false }));

export const showSettingsDialog = () => dialogStore.setState({ open: true });
export const hideSettingsDialog = () => dialogStore.setState({ open: false });
export const useSettingsDialogOpen = () => dialogStore((s) => s.open);
