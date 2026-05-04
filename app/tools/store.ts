/**
 * Tool enable/disable store. Persists per-user toggles to localStorage and
 * provides the hooks the rest of the app reads to gate UI surfaces.
 *
 * Effective enabled state = userEnabled[id] AND every tool in
 * `requires` is also effective-enabled AND the project hasn't masked the
 * tool off. Project masking is wired in via `setProjectDisabled`; this store
 * exposes the shape now so consumers can rely on `useEffectiveToolEnabled`
 * immediately.
 */

import type {
  ToolId,
  ToolManifest,
  RuntimeModeContribution,
  SettingsSectionContribution,
  ToolPlacement,
  ToolRailContribution,
} from "./types";
import { useMemo } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { getEnabledToolsIpc, setEnabledToolsIpc } from "../lib/ipc";
import { getTool, TOOLS } from "./registry";

const STORAGE_KEY = "argus:tools";

interface ToolStoreState {
  /** Project-level mask (active session's project). Updated by the project bridge. */
  projectDisabled: ToolId[];
  /** Per-tool user-toggle state. Missing entries fall back to `defaultEnabled`. */
  userEnabled: Partial<Record<ToolId, boolean>>;
}

interface PersistedState {
  userEnabled: Partial<Record<ToolId, boolean>>;
}

function load(): ToolStoreState {
  let userEnabled: Partial<Record<ToolId, boolean>> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (parsed.userEnabled && typeof parsed.userEnabled === "object") {
        for (const [id, value] of Object.entries(parsed.userEnabled)) {
          if (typeof value === "boolean" && isToolId(id)) {
            userEnabled[id] = value;
          }
        }
      }
    }
  } catch {
    userEnabled = {};
  }

  return { userEnabled, projectDisabled: [] };
}

function persist(state: ToolStoreState): void {
  try {
    const data: PersistedState = { userEnabled: state.userEnabled };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // storage unavailable
  }
  pushToBackend(state.userEnabled);
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;

function pushToBackend(userEnabled: Partial<Record<ToolId, boolean>>): void {
  // Debounce 100ms — clicking through several toggles in quick succession
  // collapses to a single round trip.
  if (pushTimer) {
    clearTimeout(pushTimer);
  }
  pushTimer = setTimeout(() => {
    pushTimer = null;
    setEnabledToolsIpc(userEnabled).catch(() => {
      // Best-effort. The renderer's localStorage is the source of truth.
    });
  }, 100);
}

/**
 * Reconcile against the backend's persisted view at app start. Disk wins —
 * the main process boots before the renderer and may have been updated by an
 * earlier session. Called once from `OnboardingRoot` (or any top-level
 * mount) via `bootstrapToolStore`.
 */
let bootstrapPromise: Promise<void> | null = null;
export function bootstrapToolStore(): Promise<void> {
  if (bootstrapPromise) {
    return bootstrapPromise;
  }
  bootstrapPromise = getEnabledToolsIpc()
    .then((diskState) => {
      // Diff to avoid an unnecessary re-render when disk matches localStorage.
      const sanitized: Partial<Record<ToolId, boolean>> = {};
      for (const [id, value] of Object.entries(diskState)) {
        if (typeof value === "boolean" && isToolId(id)) {
          sanitized[id] = value;
        }
      }
      const current = store.getState().userEnabled;
      const same =
        Object.keys(sanitized).length === Object.keys(current).length &&
        Object.entries(sanitized).every(([k, v]) => current[k as ToolId] === v);
      if (!same) {
        store.setState({ userEnabled: sanitized });
        try {
          const data: PersistedState = { userEnabled: sanitized };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch {
          // ignore
        }
      }
    })
    .catch(() => {
      // Backend unreachable (test/storybook). Leave localStorage as-is.
    });

  return bootstrapPromise;
}

function isToolId(id: string): id is ToolId {
  return TOOLS.some((t) => t.id === id);
}

const store = create<ToolStoreState>(() => load());

/** Has the user explicitly toggled this tool (regardless of requires)? */
function isUserEnabled(state: ToolStoreState, id: ToolId): boolean {
  const explicit = state.userEnabled[id];
  if (typeof explicit === "boolean") {
    return explicit;
  }

  return getTool(id).defaultEnabled;
}

/**
 * Walks `requires` to determine if the tool is actually usable. A tool is
 * effectively enabled iff:
 *   1. The user has it toggled on (explicit or default).
 *   2. Every base tool in `requires` is effectively enabled.
 *   3. The active project hasn't masked it off.
 *
 * Memoization: `requires` graphs are tiny so a fresh recursive walk per call
 * is fine. Hooks below select `userEnabled` + `projectDisabled` so the result
 * is stable across renders that don't mutate either.
 */
function effectiveEnabled(state: ToolStoreState, id: ToolId): boolean {
  if (state.projectDisabled.includes(id)) {
    return false;
  }
  if (!isUserEnabled(state, id)) {
    return false;
  }
  const tool = getTool(id);
  for (const dep of tool.requires ?? []) {
    if (!effectiveEnabled(state, dep)) {
      return false;
    }
  }

  return true;
}

// ---------- mutators ----------

export function setToolEnabled(id: ToolId, on: boolean): void {
  store.setState((s) => ({
    userEnabled: { ...s.userEnabled, [id]: on },
  }));
  persist(store.getState());
}

/** Project mask hook: called by the session/project bridge as the user
 *  changes which session is active. Pass an empty array to clear the mask. */
export function setProjectDisabled(ids: ToolId[]): void {
  // Skip writes that don't change the array — avoids cascading rerenders
  // when re-selecting the same session.
  const current = store.getState().projectDisabled;
  if (current.length === ids.length && current.every((v, i) => v === ids[i])) {
    return;
  }
  store.setState({ projectDisabled: [...ids] });
}

/** Bulk seed (used by the backend-mirror reconciler). */
export function seedUserEnabled(next: Partial<Record<ToolId, boolean>>): void {
  store.setState({ userEnabled: { ...next } });
  persist(store.getState());
}

// ---------- selectors / hooks ----------

export const getUserEnabled = (id: ToolId): boolean =>
  isUserEnabled(store.getState(), id);

export const getEffectiveToolEnabled = (id: ToolId): boolean =>
  effectiveEnabled(store.getState(), id);

export const useToolEnabled = (id: ToolId): boolean =>
  store((s) => isUserEnabled(s, id));

/** Snapshot of user-enabled state for a stable list of tool ids. */
export const useUserEnabledMany = (ids: readonly ToolId[]): boolean[] =>
  store(useShallow((s) => ids.map((id) => isUserEnabled(s, id))));

export const useEffectiveToolEnabled = (id: ToolId): boolean =>
  store((s) => effectiveEnabled(s, id));

export const useEnabledToolIds = (): ToolId[] =>
  store(
    useShallow((s) =>
      TOOLS.filter((t) => effectiveEnabled(s, t.id)).map((t) => t.id),
    ),
  );

export const useProjectDisabled = (): readonly ToolId[] =>
  store((s) => s.projectDisabled);

/** All tools, sorted by group then by registration order. */
export function useToolsForDisplay(): ToolManifest[] {
  return useMemo(
    () =>
      [...TOOLS]
        .filter((t) => !t.hidden)
        .sort((a, b) => a.group.localeCompare(b.group)),
    [],
  );
}

// ---------- contribution selectors ----------

interface ToolRailContributionWithToolId extends ToolRailContribution {
  toolId: ToolId;
}

interface RuntimeModeContributionWithToolId extends RuntimeModeContribution {
  toolId: ToolId;
}

interface SettingsSectionContributionWithToolId extends SettingsSectionContribution {
  toolId: ToolId;
}

export const useEnabledToolRailContributions = (): {
  bottom: ToolRailContributionWithToolId[];
  right: ToolRailContributionWithToolId[];
} => {
  const enabledIds = useEnabledToolIds();

  return useMemo(() => {
    const bottom: ToolRailContributionWithToolId[] = [];
    const right: ToolRailContributionWithToolId[] = [];
    for (const tool of TOOLS) {
      if (!enabledIds.includes(tool.id)) {
        continue;
      }
      for (const entry of tool.contributes?.toolRail ?? []) {
        const placed: ToolRailContributionWithToolId = {
          ...entry,
          toolId: tool.id,
        };
        if (entry.placement === "bottom") {
          bottom.push(placed);
        } else {
          right.push(placed);
        }
      }
    }

    return { bottom, right };
  }, [enabledIds]);
};

export function getToolRailPlacement(id: string): ToolPlacement | undefined {
  for (const tool of TOOLS) {
    for (const entry of tool.contributes?.toolRail ?? []) {
      if (entry.id === id) {
        return entry.placement;
      }
    }
  }

  return undefined;
}

export const useEnabledRuntimeModes =
  (): RuntimeModeContributionWithToolId[] => {
    const enabledIds = useEnabledToolIds();

    return useMemo(() => {
      const out: RuntimeModeContributionWithToolId[] = [];
      for (const tool of TOOLS) {
        if (!enabledIds.includes(tool.id)) {
          continue;
        }
        for (const mode of tool.contributes?.runtimeMode ?? []) {
          out.push({ ...mode, toolId: tool.id });
        }
      }

      return out;
    }, [enabledIds]);
  };

export const useEnabledSettingsSections =
  (): SettingsSectionContributionWithToolId[] => {
    const enabledIds = useEnabledToolIds();

    return useMemo(() => {
      const out: SettingsSectionContributionWithToolId[] = [];
      for (const tool of TOOLS) {
        if (!enabledIds.includes(tool.id)) {
          continue;
        }
        for (const section of tool.contributes?.settingsSection ?? []) {
          out.push({ ...section, toolId: tool.id });
        }
      }

      return out;
    }, [enabledIds]);
  };

// ---------- testing helpers ----------

/** @internal Reset state for tests. Not exported via index. */
export function __resetToolStoreForTests(): void {
  // Re-run load() so legacy-key migration is exercised with whatever
  // localStorage state the test set up.
  store.setState(load());
}
