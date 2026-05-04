/**
 * Plugin enable/disable store. Persists per-user toggles to localStorage and
 * provides the hooks the rest of the app reads to gate UI surfaces.
 *
 * Effective enabled state = userEnabled[id] AND every plugin in
 * `requires` is also effective-enabled AND the project hasn't masked the
 * plugin off. Project masking is wired in chunk 9; this store exposes the
 * shape now so consumers can rely on `useEffectivePluginEnabled` immediately.
 */

import type {
  PluginId,
  PluginManifest,
  RuntimeModeContribution,
  SettingsSectionContribution,
  ToolPlacement,
  ToolRailContribution,
} from "./types";
import { useMemo } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { getEnabledPluginsIpc, setEnabledPluginsIpc } from "../lib/ipc";
import { getPlugin, PLUGINS } from "./registry";

const STORAGE_KEY = "argus:plugins";

interface PluginStoreState {
  /** Project-level mask (active session's project). Updated by the project bridge. */
  projectDisabled: PluginId[];
  /** Per-plugin user-toggle state. Missing entries fall back to `defaultEnabled`. */
  userEnabled: Partial<Record<PluginId, boolean>>;
}

interface PersistedState {
  userEnabled: Partial<Record<PluginId, boolean>>;
}

function load(): PluginStoreState {
  let userEnabled: Partial<Record<PluginId, boolean>> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (parsed.userEnabled && typeof parsed.userEnabled === "object") {
        for (const [id, value] of Object.entries(parsed.userEnabled)) {
          if (typeof value === "boolean" && isPluginId(id)) {
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

function persist(state: PluginStoreState): void {
  try {
    const data: PersistedState = { userEnabled: state.userEnabled };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // storage unavailable
  }
  pushToBackend(state.userEnabled);
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;

function pushToBackend(userEnabled: Partial<Record<PluginId, boolean>>): void {
  // Debounce 100ms — clicking through several toggles in quick succession
  // collapses to a single round trip.
  if (pushTimer) {
    clearTimeout(pushTimer);
  }
  pushTimer = setTimeout(() => {
    pushTimer = null;
    setEnabledPluginsIpc(userEnabled).catch(() => {
      // Best-effort. The renderer's localStorage is the source of truth.
    });
  }, 100);
}

/**
 * Reconcile against the backend's persisted view at app start. Disk wins —
 * the main process boots before the renderer and may have been updated by an
 * earlier session. Called once from `OnboardingRoot` (or any top-level
 * mount) via `bootstrapPluginStore`.
 */
let bootstrapPromise: Promise<void> | null = null;
export function bootstrapPluginStore(): Promise<void> {
  if (bootstrapPromise) {
    return bootstrapPromise;
  }
  bootstrapPromise = getEnabledPluginsIpc()
    .then((diskState) => {
      // Diff to avoid an unnecessary re-render when disk matches localStorage.
      const sanitized: Partial<Record<PluginId, boolean>> = {};
      for (const [id, value] of Object.entries(diskState)) {
        if (typeof value === "boolean" && isPluginId(id)) {
          sanitized[id] = value;
        }
      }
      const current = store.getState().userEnabled;
      const same =
        Object.keys(sanitized).length === Object.keys(current).length &&
        Object.entries(sanitized).every(
          ([k, v]) => current[k as PluginId] === v,
        );
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

function isPluginId(id: string): id is PluginId {
  return PLUGINS.some((p) => p.id === id);
}

const store = create<PluginStoreState>(() => load());

/** Has the user explicitly toggled this plugin (regardless of requires)? */
function isUserEnabled(state: PluginStoreState, id: PluginId): boolean {
  const explicit = state.userEnabled[id];
  if (typeof explicit === "boolean") {
    return explicit;
  }

  return getPlugin(id).defaultEnabled;
}

/**
 * Walks `requires` to determine if the plugin is actually usable. A plugin is
 * effectively enabled iff:
 *   1. The user has it toggled on (explicit or default).
 *   2. Every base plugin in `requires` is effectively enabled.
 *   3. The active project hasn't masked it off.
 *
 * Memoization: `requires` graphs are tiny so a fresh recursive walk per call
 * is fine. Hooks below select `userEnabled` + `projectDisabled` so the result
 * is stable across renders that don't mutate either.
 */
function effectiveEnabled(state: PluginStoreState, id: PluginId): boolean {
  if (state.projectDisabled.includes(id)) {
    return false;
  }
  if (!isUserEnabled(state, id)) {
    return false;
  }
  const plugin = getPlugin(id);
  for (const dep of plugin.requires ?? []) {
    if (!effectiveEnabled(state, dep)) {
      return false;
    }
  }

  return true;
}

// ---------- mutators ----------

export function setPluginEnabled(id: PluginId, on: boolean): void {
  store.setState((s) => ({
    userEnabled: { ...s.userEnabled, [id]: on },
  }));
  persist(store.getState());
}

/** Project mask hook: called by the session/project bridge as the user
 *  changes which session is active. Pass an empty array to clear the mask. */
export function setProjectDisabled(ids: PluginId[]): void {
  // Skip writes that don't change the array — avoids cascading rerenders
  // when re-selecting the same session.
  const current = store.getState().projectDisabled;
  if (current.length === ids.length && current.every((v, i) => v === ids[i])) {
    return;
  }
  store.setState({ projectDisabled: [...ids] });
}

/** Bulk seed (used by the backend-mirror reconciler in chunk 4). */
export function seedUserEnabled(
  next: Partial<Record<PluginId, boolean>>,
): void {
  store.setState({ userEnabled: { ...next } });
  persist(store.getState());
}

// ---------- selectors / hooks ----------

export const getUserEnabled = (id: PluginId): boolean =>
  isUserEnabled(store.getState(), id);

export const getEffectivePluginEnabled = (id: PluginId): boolean =>
  effectiveEnabled(store.getState(), id);

export const usePluginEnabled = (id: PluginId): boolean =>
  store((s) => isUserEnabled(s, id));

/** Snapshot of user-enabled state for a stable list of plugin ids. */
export const useUserEnabledMany = (ids: readonly PluginId[]): boolean[] =>
  store(useShallow((s) => ids.map((id) => isUserEnabled(s, id))));

export const useEffectivePluginEnabled = (id: PluginId): boolean =>
  store((s) => effectiveEnabled(s, id));

export const useEnabledPluginIds = (): PluginId[] =>
  store(
    useShallow((s) =>
      PLUGINS.filter((p) => effectiveEnabled(s, p.id)).map((p) => p.id),
    ),
  );

export const useProjectDisabled = (): readonly PluginId[] =>
  store((s) => s.projectDisabled);

/** All plugins, sorted by group then by registration order. */
export function usePluginsForDisplay(): PluginManifest[] {
  return useMemo(
    () =>
      [...PLUGINS]
        .filter((p) => !p.hidden)
        .sort((a, b) => a.group.localeCompare(b.group)),
    [],
  );
}

// ---------- contribution selectors ----------

interface ToolRailContributionWithPluginId extends ToolRailContribution {
  pluginId: PluginId;
}

interface RuntimeModeContributionWithPluginId extends RuntimeModeContribution {
  pluginId: PluginId;
}

interface SettingsSectionContributionWithPluginId extends SettingsSectionContribution {
  pluginId: PluginId;
}

export const useEnabledToolRailContributions = (): {
  bottom: ToolRailContributionWithPluginId[];
  right: ToolRailContributionWithPluginId[];
} =>
  store(
    useShallow((s) => {
      const bottom: ToolRailContributionWithPluginId[] = [];
      const right: ToolRailContributionWithPluginId[] = [];
      for (const plugin of PLUGINS) {
        if (!effectiveEnabled(s, plugin.id)) {
          continue;
        }
        for (const entry of plugin.contributes?.toolRail ?? []) {
          const placed: ToolRailContributionWithPluginId = {
            ...entry,
            pluginId: plugin.id,
          };
          if (entry.placement === "bottom") {
            bottom.push(placed);
          } else {
            right.push(placed);
          }
        }
      }

      return { bottom, right };
    }),
  );

export function getToolRailPlacement(id: string): ToolPlacement | undefined {
  for (const plugin of PLUGINS) {
    for (const entry of plugin.contributes?.toolRail ?? []) {
      if (entry.id === id) {
        return entry.placement;
      }
    }
  }

  return undefined;
}

export const useEnabledRuntimeModes =
  (): RuntimeModeContributionWithPluginId[] =>
    store(
      useShallow((s) => {
        const out: RuntimeModeContributionWithPluginId[] = [];
        for (const plugin of PLUGINS) {
          if (!effectiveEnabled(s, plugin.id)) {
            continue;
          }
          for (const mode of plugin.contributes?.runtimeMode ?? []) {
            out.push({ ...mode, pluginId: plugin.id });
          }
        }

        return out;
      }),
    );

export const useEnabledSettingsSections =
  (): SettingsSectionContributionWithPluginId[] =>
    store(
      useShallow((s) => {
        const out: SettingsSectionContributionWithPluginId[] = [];
        for (const plugin of PLUGINS) {
          if (!effectiveEnabled(s, plugin.id)) {
            continue;
          }
          for (const section of plugin.contributes?.settingsSection ?? []) {
            out.push({ ...section, pluginId: plugin.id });
          }
        }

        return out;
      }),
    );

// ---------- testing helpers ----------

/** @internal Reset state for tests. Not exported via index. */
export function __resetPluginStoreForTests(): void {
  store.setState({ userEnabled: {}, projectDisabled: [] });
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
