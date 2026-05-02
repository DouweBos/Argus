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

export type WorkingCopyView = "flat" | "tree";
export type DiffViewMode = "split" | "unified";
export type CommitSigningFormat = "gpg" | "ssh";

interface SettingsState {
  /** Map of `rememberKey` → user opted out of the corresponding confirm dialog. */
  confirmPreferences: Record<string, boolean>;
  /** Conventional Commits prefix picker on/off (Phase 2 W10). */
  conventionalCommitsPicker: boolean;
  customEditors: CustomEditor[];
  /** Model id seeded into the launcher / new-session dialog. Empty = CLI default. */
  defaultModel: string;
  defaultPermissionMode: PermissionMode;
  /** Default strategy used by the project-scope pull dialog (Phase 6B P11). */
  defaultPullStrategy: "ff-only" | "merge" | "rebase";
  diffView: DiffViewMode;
  diffWhitespace: boolean;
  diffWordDiff: boolean;
  /** Phase 3 K4 — collapse the git source sidebar (Working Copy / Branch / …). */
  gitSidebarCollapsed: boolean;
  /**
   * Which collapsible sections in the source sidebar are collapsed.
   * Keys: "branches" | "tags" | "remotes" | "submodules" | "worktrees".
   */
  gitSidebarSectionsCollapsed: Record<string, boolean>;
  /** Width of the git source sidebar as a fraction of the GitView container. */
  gitSidebarWidth: number;
  showAssumeUnchangedFiles: boolean;
  /**
   * Working copy view toggles.
   * showIgnoredFiles: include files listed by `git status --ignored`.
   * showAssumeUnchangedFiles: include files marked with `git update-index --assume-unchanged`.
   * showNonModifiedFiles: in tree mode, show unmodified tracked files.
   */
  showIgnoredFiles: boolean;
  showNonModifiedFiles: boolean;
  telemetryEnabled: boolean;
  /** Working-copy file list — flat list or tree by path (Phase 2 W2). */
  workingCopyView: WorkingCopyView;
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
        defaultModel:
          typeof parsed.defaultModel === "string" ? parsed.defaultModel : "",
        customEditors: sanitizeCustomEditors(parsed.customEditors),
        telemetryEnabled:
          typeof parsed.telemetryEnabled === "boolean"
            ? parsed.telemetryEnabled
            : false,
        confirmPreferences:
          parsed.confirmPreferences &&
          typeof parsed.confirmPreferences === "object"
            ? Object.fromEntries(
                Object.entries(parsed.confirmPreferences).filter(
                  ([, v]) => typeof v === "boolean",
                ),
              )
            : {},
        workingCopyView: parsed.workingCopyView === "tree" ? "tree" : "flat",
        diffView: parsed.diffView === "split" ? "split" : "unified",
        diffWhitespace: parsed.diffWhitespace === true,
        diffWordDiff: parsed.diffWordDiff === true,
        conventionalCommitsPicker: parsed.conventionalCommitsPicker === true,
        gitSidebarCollapsed: parsed.gitSidebarCollapsed === true,
        gitSidebarWidth:
          typeof parsed.gitSidebarWidth === "number" &&
          parsed.gitSidebarWidth > 0.05 &&
          parsed.gitSidebarWidth < 0.6
            ? parsed.gitSidebarWidth
            : 0.18,
        gitSidebarSectionsCollapsed:
          parsed.gitSidebarSectionsCollapsed &&
          typeof parsed.gitSidebarSectionsCollapsed === "object" &&
          !Array.isArray(parsed.gitSidebarSectionsCollapsed)
            ? (parsed.gitSidebarSectionsCollapsed as Record<string, boolean>)
            : {},
        defaultPullStrategy:
          parsed.defaultPullStrategy === "rebase" ||
          parsed.defaultPullStrategy === "ff-only"
            ? parsed.defaultPullStrategy
            : "merge",
        showIgnoredFiles: parsed.showIgnoredFiles === true,
        showAssumeUnchangedFiles: parsed.showAssumeUnchangedFiles === true,
        showNonModifiedFiles: parsed.showNonModifiedFiles === true,
      };
    }
  } catch {
    // fall through to defaults
  }

  // Telemetry default opt-out — consent is collected explicitly during the
  // telemetry onboarding step before any analytics events are sent.
  return {
    defaultPermissionMode: "default",
    defaultModel: "",
    customEditors: [],
    telemetryEnabled: false,
    confirmPreferences: {},
    workingCopyView: "flat",
    diffView: "unified",
    diffWhitespace: false,
    diffWordDiff: false,
    conventionalCommitsPicker: false,
    gitSidebarCollapsed: false,
    gitSidebarWidth: 0.18,
    gitSidebarSectionsCollapsed: {},
    defaultPullStrategy: "merge",
    showIgnoredFiles: false,
    showAssumeUnchangedFiles: false,
    showNonModifiedFiles: false,
  };
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

export const setDefaultModel = (model: string) => {
  store.setState({ defaultModel: model });
  persist(store.getState());
};

export const useDefaultModel = () => store((s) => s.defaultModel);

export const getDefaultModel = () => store.getState().defaultModel;

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

export const useTelemetryEnabled = () => store((s) => s.telemetryEnabled);

export const getTelemetryEnabled = () => store.getState().telemetryEnabled;

export const setTelemetryEnabledSetting = (enabled: boolean): void => {
  store.setState({ telemetryEnabled: enabled });
  persist(store.getState());
};

export const removeCustomEditor = (id: string): void => {
  store.setState((s) => ({
    customEditors: s.customEditors.filter((e) => e.id !== id),
  }));
  persist(store.getState());
};

/**
 * Persisted "don't ask again" map for `<DestructiveConfirm>`. Consumers
 * should call `getConfirmPreference(key)` before opening the dialog and
 * `setConfirmPreference(key, true)` when the user ticks the skip-next-time
 * checkbox.
 */
export const getConfirmPreference = (key: string): boolean =>
  Boolean(store.getState().confirmPreferences[key]);

export const setConfirmPreference = (key: string, skip: boolean): void => {
  store.setState((s) => ({
    confirmPreferences: { ...s.confirmPreferences, [key]: skip },
  }));
  persist(store.getState());
};

// Phase 2 W2 / W7 / W10 — git view preferences.

export const useWorkingCopyView = (): WorkingCopyView =>
  store((s) => s.workingCopyView);

export const setWorkingCopyView = (view: WorkingCopyView): void => {
  store.setState({ workingCopyView: view });
  persist(store.getState());
};

export const useDiffView = (): DiffViewMode => store((s) => s.diffView);

export const setDiffView = (mode: DiffViewMode): void => {
  store.setState({ diffView: mode });
  persist(store.getState());
};

export const useDiffWhitespace = (): boolean => store((s) => s.diffWhitespace);

export const setDiffWhitespace = (on: boolean): void => {
  store.setState({ diffWhitespace: on });
  persist(store.getState());
};

export const useDiffWordDiff = (): boolean => store((s) => s.diffWordDiff);

export const setDiffWordDiff = (on: boolean): void => {
  store.setState({ diffWordDiff: on });
  persist(store.getState());
};

export const useConventionalCommitsPicker = (): boolean =>
  store((s) => s.conventionalCommitsPicker);

export const setConventionalCommitsPicker = (on: boolean): void => {
  store.setState({ conventionalCommitsPicker: on });
  persist(store.getState());
};

// Phase 3 K4 — git source sidebar collapse state.

export const useGitSidebarCollapsed = (): boolean =>
  store((s) => s.gitSidebarCollapsed);

export const setGitSidebarCollapsed = (collapsed: boolean): void => {
  store.setState({ gitSidebarCollapsed: collapsed });
  persist(store.getState());
};

export const useDefaultPullStrategy = (): "ff-only" | "merge" | "rebase" =>
  store((s) => s.defaultPullStrategy);

export const setDefaultPullStrategy = (
  strategy: "ff-only" | "merge" | "rebase",
): void => {
  store.setState({ defaultPullStrategy: strategy });
  persist(store.getState());
};

export const getDefaultPullStrategy = (): "ff-only" | "merge" | "rebase" =>
  store.getState().defaultPullStrategy;

export const toggleGitSidebarCollapsed = (): void => {
  store.setState((s) => ({ gitSidebarCollapsed: !s.gitSidebarCollapsed }));
  persist(store.getState());
};

export const useGitSidebarWidth = (): number => store((s) => s.gitSidebarWidth);

export const setGitSidebarWidth = (width: number): void => {
  store.setState({ gitSidebarWidth: width });
  persist(store.getState());
};

export const useGitSidebarSectionsCollapsed = (): Record<string, boolean> =>
  store((s) => s.gitSidebarSectionsCollapsed);

export const toggleGitSidebarSection = (key: string): void => {
  store.setState((s) => ({
    gitSidebarSectionsCollapsed: {
      ...s.gitSidebarSectionsCollapsed,
      [key]: !s.gitSidebarSectionsCollapsed[key],
    },
  }));
  persist(store.getState());
};

/**
 * Explicitly set the collapsed state for a sidebar section. Lets callers that
 * track a default-collapsed flag flip a section to the opposite of its
 * *visual* state without having to know the persisted value.
 */
export const setGitSidebarSectionCollapsed = (
  key: string,
  collapsed: boolean,
): void => {
  store.setState((s) => ({
    gitSidebarSectionsCollapsed: {
      ...s.gitSidebarSectionsCollapsed,
      [key]: collapsed,
    },
  }));
  persist(store.getState());
};

// Phase 4 — working copy view toggles.

export const useShowIgnoredFiles = (): boolean =>
  store((s) => s.showIgnoredFiles);

export const setShowIgnoredFiles = (on: boolean): void => {
  store.setState({ showIgnoredFiles: on });
  persist(store.getState());
};

export const useShowAssumeUnchangedFiles = (): boolean =>
  store((s) => s.showAssumeUnchangedFiles);

export const setShowAssumeUnchangedFiles = (on: boolean): void => {
  store.setState({ showAssumeUnchangedFiles: on });
  persist(store.getState());
};

export const useShowNonModifiedFiles = (): boolean =>
  store((s) => s.showNonModifiedFiles);

export const setShowNonModifiedFiles = (on: boolean): void => {
  store.setState({ showNonModifiedFiles: on });
  persist(store.getState());
};

interface SettingsDialogState {
  open: boolean;
}

const dialogStore = create<SettingsDialogState>(() => ({ open: false }));

export const showSettingsDialog = () => dialogStore.setState({ open: true });
export const hideSettingsDialog = () => dialogStore.setState({ open: false });
export const useSettingsDialogOpen = () => dialogStore((s) => s.open);
