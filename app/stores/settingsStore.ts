import type { CanonicalPermissionMode } from "../lib/permissionModes";
import type { RemoteEndpoint } from "../lib/types";
import { create } from "zustand";
import { mirrorToHost, onHostPrefChange } from "../lib/hostPrefs";

/**
 * App-level default permission mode for new agents. Canonical names — the
 * runner abstraction translates them to runner-native vocabulary.
 */
export type PermissionMode = CanonicalPermissionMode;

export const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  auto: "Auto (smart approvals)",
  ask: "Ask before each tool",
  plan: "Plan mode",
  review: "Accept edits automatically",
  trusted: "Bypass permissions (yolo)",
};

/**
 * A paired Argus host this Mac can attach to. Holds this device's Noise static
 * keypair for that host — client-local, never sent anywhere but the host it was
 * minted for. The host decides what the grant allows; driving a host as a
 * second keyboard needs `admin`.
 */
export interface RemoteHost {
  /** Capabilities the host granted at pairing (informational — the host enforces). */
  capabilities: string[];
  devPrivB64: string;
  devPubB64: string;
  /** Every route the host announced, best first; absent on older entries. */
  endpoints?: RemoteEndpoint[];
  hostPubB64: string;
  /** Device id the host issued us. Stable across reconnects. */
  id: string;
  /** User-facing name for the machine ("Mac mini"). */
  label: string;
  pairedAt: number;
  /** A QR pairing (absent on older entries), or a computer on your account. */
  source?: "account" | "pairing";
  /** `ws://` or `wss://` origin of that host's gateway: the last route that worked. */
  url: string;
}

export interface CustomEditor {
  command: string;
  id: string;
  name: string;
}

export type WorkingCopyView = "flat" | "tree";
export type DiffViewMode = "split" | "unified";
export type CommitSigningFormat = "gpg" | "ssh";

/**
 * Two telemetry levels:
 * - `presence`: a single anonymous heartbeat per launch carrying just the
 *   app version. Lets us count DAU without seeing what anyone does.
 * - `full`: the full event catalogue documented in `docs/telemetry-events.md`.
 */
export type TelemetryMode = "full" | "presence";

export const TELEMETRY_MODE_LABELS: Record<TelemetryMode, string> = {
  presence: "Presence only",
  full: "Full analytics",
};

export interface DefaultLlm {
  /** Optional model id passed to the runner. `null` lets the runner pick. */
  model: string | null;
  /** Runner id (e.g. "claude-code"). Defaults to the only registered runner today. */
  runner: string | null;
}

export const DEFAULT_LLM_RUNNER = "claude-code";

export type StartWorkspace = "current" | "worktree";

interface SettingsState {
  /**
   * Hosts attached at launch. Several can be live at once — a Mac mini for
   * iOS work, a Linux box for Android — and each keeps its own connection.
   * Which one a screen *reads from* lives in the URL, not here.
   */
  attachedRemoteHostIds: string[];
  /** Map of `rememberKey` → user opted out of the corresponding confirm dialog. */
  confirmPreferences: Record<string, boolean>;
  /** Conventional Commits prefix picker on/off (Phase 2 W10). */
  conventionalCommitsPicker: boolean;
  customEditors: CustomEditor[];
  /** App-level default LLM runner + model used when project/session don't specify one. */
  defaultLlm: DefaultLlm;
  /** Model id seeded into the new-session dialog. Empty = CLI default. */
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
  /**
   * The name on a huddle invite ("Ana wants you to join…"). Empty falls back to
   * the repo's git `user.name`, which is right for most people and wrong for
   * anyone who commits under a name they don't go by.
   */
  huddleDisplayName: string;
  /**
   * Last reasoning-effort level chosen by the user, keyed by runner id.
   * Replayed as the default for new agents on the same runner.
   */
  lastEffortByRunner: Record<string, string | null>;
  /** Paired hosts, in pairing order. */
  remoteHosts: RemoteHost[];
  showAssumeUnchangedFiles: boolean;
  /**
   * Working copy view toggles.
   * showIgnoredFiles: include files listed by `git status --ignored`.
   * showAssumeUnchangedFiles: include files marked with `git update-index --assume-unchanged`.
   * showNonModifiedFiles: in tree mode, show unmodified tracked files.
   */
  showIgnoredFiles: boolean;
  showNonModifiedFiles: boolean;
  /** Where a prompt typed on a project's home starts: a fresh worktree, or the checkout itself. */
  startWorkspace: StartWorkspace;
  telemetryMode: TelemetryMode;
  /** Working-copy file list — flat list or tree by path (Phase 2 W2). */
  workingCopyView: WorkingCopyView;
}

const STORAGE_KEY = "argus:settings";

function sanitizeDefaultLlm(input: unknown): DefaultLlm {
  if (!input || typeof input !== "object") {
    return { runner: DEFAULT_LLM_RUNNER, model: null };
  }
  const obj = input as Record<string, unknown>;
  const runner =
    typeof obj.runner === "string" && obj.runner.trim()
      ? obj.runner.trim()
      : DEFAULT_LLM_RUNNER;
  const model =
    typeof obj.model === "string" && obj.model.trim() ? obj.model.trim() : null;

  return { runner, model };
}

function sanitizeTelemetryMode(mode: unknown): TelemetryMode {
  return mode === "full" ? "full" : "presence";
}

function sanitizeLastEffortByRunner(
  input: unknown,
): Record<string, string | null> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  const result: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!key.trim()) {
      continue;
    }
    if (value === null) {
      result[key] = null;
    } else if (typeof value === "string" && value.trim()) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Normalise a persisted permission mode to a canonical value. Pre-canonical
 * builds stored Claude-native names — migrate them. The legacy `"default"`
 * (the old fallback nobody explicitly picked) and any unrecognised value
 * become `"auto"`, the current default.
 */
function sanitizeDefaultPermissionMode(raw: unknown): CanonicalPermissionMode {
  switch (raw) {
    case "auto":
    case "ask":
    case "plan":
    case "review":
    case "trusted":
      return raw;
    case "acceptEdits":
      return "review";
    case "bypassPermissions":
      return "trusted";
    default:
      return "auto";
  }
}

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

/**
 * Reads both the current list and the single `activeRemoteHostId` written by
 * versions that could only attach to one host at a time.
 */
function sanitizeHostIds(parsed: Record<string, unknown>): string[] {
  const list = parsed.attachedRemoteHostIds;
  if (Array.isArray(list)) {
    return list.filter((id): id is string => typeof id === "string");
  }

  return typeof parsed.activeRemoteHostId === "string"
    ? [parsed.activeRemoteHostId]
    : [];
}

function sanitizeRemoteHosts(input: unknown): RemoteHost[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.flatMap((raw): RemoteHost[] => {
    if (!raw || typeof raw !== "object") {
      return [];
    }
    const o = raw as Record<string, unknown>;
    const strings = ["id", "url", "devPrivB64", "devPubB64", "hostPubB64"];
    if (strings.some((k) => typeof o[k] !== "string" || !o[k])) {
      return [];
    }

    return [
      {
        id: o.id as string,
        label: typeof o.label === "string" ? o.label : "Host",
        url: o.url as string,
        devPrivB64: o.devPrivB64 as string,
        devPubB64: o.devPubB64 as string,
        hostPubB64: o.hostPubB64 as string,
        capabilities: Array.isArray(o.capabilities)
          ? o.capabilities.filter((c): c is string => typeof c === "string")
          : [],
        pairedAt: typeof o.pairedAt === "number" ? o.pairedAt : 0,
        ...(o.source === "account" || o.source === "pairing"
          ? { source: o.source }
          : {}),
        ...(Array.isArray(o.endpoints)
          ? { endpoints: sanitizeEndpoints(o.endpoints) }
          : {}),
      },
    ];
  });
}

const ENDPOINT_KINDS = new Set(["cloudflare", "lan", "tailscale"]);

function sanitizeEndpoints(input: unknown[]): RemoteEndpoint[] {
  return input.flatMap((raw): RemoteEndpoint[] => {
    const e = (raw ?? {}) as Record<string, unknown>;
    if (
      typeof e.url !== "string" ||
      typeof e.priority !== "number" ||
      typeof e.kind !== "string" ||
      !ENDPOINT_KINDS.has(e.kind)
    ) {
      return [];
    }

    return [
      {
        kind: e.kind as RemoteEndpoint["kind"],
        priority: e.priority,
        url: e.url,
      },
    ];
  });
}

function load(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SettingsState>;

      return {
        defaultPermissionMode: sanitizeDefaultPermissionMode(
          parsed.defaultPermissionMode,
        ),
        defaultModel:
          typeof parsed.defaultModel === "string" ? parsed.defaultModel : "",
        huddleDisplayName:
          typeof parsed.huddleDisplayName === "string"
            ? parsed.huddleDisplayName
            : "",
        customEditors: sanitizeCustomEditors(parsed.customEditors),
        defaultLlm: sanitizeDefaultLlm(parsed.defaultLlm),
        telemetryMode: sanitizeTelemetryMode(parsed.telemetryMode),
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
        startWorkspace:
          parsed.startWorkspace === "current" ? "current" : "worktree",
        lastEffortByRunner: sanitizeLastEffortByRunner(
          parsed.lastEffortByRunner,
        ),
        remoteHosts: sanitizeRemoteHosts(parsed.remoteHosts),
        attachedRemoteHostIds: sanitizeHostIds(
          parsed as Record<string, unknown>,
        ),
      };
    }
  } catch {
    // fall through to defaults
  }

  return {
    defaultPermissionMode: "auto",
    defaultModel: "",
    huddleDisplayName: "",
    customEditors: [],
    defaultLlm: { runner: DEFAULT_LLM_RUNNER, model: null },
    telemetryMode: "presence",
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
    startWorkspace: "worktree",
    lastEffortByRunner: {},
    remoteHosts: [],
    attachedRemoteHostIds: [],
  };
}

function persist(state: SettingsState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    mirrorToHost(STORAGE_KEY);
  } catch {
    // storage unavailable
  }
}

const store = create<SettingsState>(() => load());
onHostPrefChange(STORAGE_KEY, () => store.setState(load()));

export const setDefaultPermissionMode = (mode: PermissionMode) => {
  store.setState({ defaultPermissionMode: mode });
  persist(store.getState());
};

export const useDefaultPermissionMode = () =>
  store((s) => s.defaultPermissionMode);

export const getDefaultPermissionMode = () =>
  store.getState().defaultPermissionMode;

export const setStartWorkspace = (startWorkspace: StartWorkspace) => {
  store.setState({ startWorkspace });
  persist(store.getState());
};

export const useStartWorkspace = () => store((s) => s.startWorkspace);

export const getStartWorkspace = () => store.getState().startWorkspace;

export const setDefaultModel = (model: string) => {
  store.setState({ defaultModel: model });
  persist(store.getState());
};

export const setHuddleDisplayName = (name: string) => {
  store.setState({ huddleDisplayName: name });
  persist(store.getState());
};

export const useHuddleDisplayName = () => store((s) => s.huddleDisplayName);

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

export const useTelemetryMode = () => store((s) => s.telemetryMode);

export const getTelemetryMode = () => store.getState().telemetryMode;

export const setTelemetryModeSetting = (mode: TelemetryMode): void => {
  store.setState({ telemetryMode: mode });
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

// LLM — app-level default runner + model (Phase 2A of llm-routing-abstraction).

export const useDefaultLlm = (): DefaultLlm => store((s) => s.defaultLlm);

export const getDefaultLlm = (): DefaultLlm => store.getState().defaultLlm;

export const setDefaultLlmRunner = (runner: string | null): void => {
  const next = runner && runner.trim() ? runner.trim() : null;
  store.setState((s) => ({ defaultLlm: { ...s.defaultLlm, runner: next } }));
  persist(store.getState());
};

export const setDefaultLlmModel = (model: string | null): void => {
  const next = model && model.trim() ? model.trim() : null;
  store.setState((s) => ({ defaultLlm: { ...s.defaultLlm, model: next } }));
  persist(store.getState());
};

// Reasoning-effort defaults — last picked level per runner, replayed on new agents.

export const getLastEffortForRunner = (runnerId: string): string | null => {
  const map = store.getState().lastEffortByRunner;

  return Object.prototype.hasOwnProperty.call(map, runnerId)
    ? map[runnerId]
    : null;
};

export const setLastEffortForRunner = (
  runnerId: string,
  level: string | null,
): void => {
  const id = runnerId.trim();
  if (!id) {
    return;
  }
  store.setState((s) => ({
    lastEffortByRunner: { ...s.lastEffortByRunner, [id]: level },
  }));
  persist(store.getState());
};

interface SettingsDialogState {
  /** Section to open on first render (e.g. "remote-access"). */
  initialSectionId?: string;
  open: boolean;
  /** Bumped per request so an open dialog can jump to another section. */
  request: number;
}

const dialogStore = create<SettingsDialogState>(() => ({
  open: false,
  request: 0,
}));

export const showSettingsDialog = (initialSectionId?: string) =>
  dialogStore.setState((s) => ({
    open: true,
    initialSectionId,
    request: s.request + 1,
  }));
export const hideSettingsDialog = () => dialogStore.setState({ open: false });
export const useSettingsDialogOpen = () => dialogStore((s) => s.open);
export const useSettingsInitialSection = () =>
  dialogStore((s) => s.initialSectionId);
export const useSettingsDialogRequest = () => dialogStore((s) => s.request);

// --- Paired hosts -----------------------------------------------------------

export const useRemoteHosts = (): RemoteHost[] => store((s) => s.remoteHosts);

export const getRemoteHosts = (): RemoteHost[] => store.getState().remoteHosts;

export const useAttachedRemoteHostIds = (): string[] =>
  store((s) => s.attachedRemoteHostIds);

export const getAttachedHostIds = (): string[] =>
  store.getState().attachedRemoteHostIds;

export const getRemoteHost = (id: string | null): RemoteHost | null =>
  id ? (store.getState().remoteHosts.find((h) => h.id === id) ?? null) : null;

export const addRemoteHost = (host: RemoteHost): void => {
  store.setState((s) => ({
    remoteHosts: [...s.remoteHosts.filter((h) => h.id !== host.id), host],
  }));
  persist(store.getState());
};

export const renameRemoteHost = (id: string, label: string): void => {
  store.setState((s) => ({
    remoteHosts: s.remoteHosts.map((h) => (h.id === id ? { ...h, label } : h)),
  }));
  persist(store.getState());
};

/** A host's routes moved, or one of them just worked. Unknown ids are ignored. */
export const updateRemoteHostRoutes = (
  id: string,
  patch: { endpoints?: RemoteEndpoint[]; url?: string },
): void => {
  const host = getRemoteHost(id);
  if (!host) {
    return;
  }
  const next = { ...host, ...patch };
  if (
    next.url === host.url &&
    JSON.stringify(next.endpoints) === JSON.stringify(host.endpoints)
  ) {
    return;
  }
  store.setState((s) => ({
    remoteHosts: s.remoteHosts.map((h) => (h.id === id ? next : h)),
  }));
  persist(store.getState());
};

export const forgetRemoteHost = (id: string): void => {
  store.setState((s) => ({
    remoteHosts: s.remoteHosts.filter((h) => h.id !== id),
    attachedRemoteHostIds: s.attachedRemoteHostIds.filter((h) => h !== id),
  }));
  persist(store.getState());
};

/** Remember which hosts to bring back up at the next launch. */
export const setAttachedHostIds = (ids: string[]): void => {
  store.setState({ attachedRemoteHostIds: ids });
  persist(store.getState());
};
