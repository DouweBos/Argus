/**
 * Which renderer `localStorage` entries the host owns, and where they live
 * there: preferences in `app-settings.json`, per-home picks in the host's UI
 * state. Argus for Mac reads and writes the same host values, so switching
 * apps keeps them. Everything not listed here stays in this renderer.
 */

import type { AppSettings } from "./types";
import { LOCAL_HOST_ID } from "./transport/hostId";

export type HostSlot = { setting: keyof AppSettings } | { uiState: string };

export interface PrefBinding {
  host: HostSlot;
  /** The `localStorage` key the renderer's store persists to. */
  local: string;
  /** The host's value for a stored local string; undefined when it holds none. */
  read: (raw: string) => unknown;
  /** The local string for a host value; undefined when the value is unusable. */
  write: (value: unknown, raw: string | null) => string | undefined;
}

export function slotId(slot: HostSlot): string {
  return "setting" in slot ? `setting:${slot.setting}` : `ui:${slot.uiState}`;
}

function oneOf<T extends string>(values: readonly T[]): (v: unknown) => v is T {
  return (v): v is T => typeof v === "string" && values.includes(v as T);
}

const isString = (v: unknown): v is string => typeof v === "string";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isStringMap = (v: unknown): v is Record<string, string> =>
  isRecord(v) && Object.values(v).every(isString);

function parse(raw: string | null): unknown {
  try {
    return raw === null ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

/** A key that stores a bare string (`"dark"`, `"ios"`). */
function plain(
  local: string,
  host: HostSlot,
  valid: (v: unknown) => boolean = isString,
): PrefBinding {
  return {
    local,
    host,
    read: (raw) => (valid(raw) ? raw : undefined),
    write: (value) => (valid(value) ? String(value) : undefined),
  };
}

/** A key that stores JSON. */
function json(
  local: string,
  host: HostSlot,
  valid: (v: unknown) => boolean,
): PrefBinding {
  return {
    local,
    host,
    read: (raw) => {
      const v = parse(raw);

      return valid(v) ? v : undefined;
    },
    write: (value) => (valid(value) ? JSON.stringify(value) : undefined),
  };
}

const SETTINGS_KEY = "argus:settings";

/** One field of the settings store's single JSON blob. */
function settingsField(
  field: string,
  setting: keyof AppSettings,
  valid: (v: unknown) => boolean,
): PrefBinding {
  return {
    local: SETTINGS_KEY,
    host: { setting },
    read: (raw) => {
      const blob = parse(raw);
      const v = isRecord(blob) ? blob[field] : undefined;

      return valid(v) ? v : undefined;
    },
    write: (value, raw) => {
      if (!valid(value)) {
        return undefined;
      }
      const blob = parse(raw);

      return JSON.stringify({
        ...(isRecord(blob) ? blob : {}),
        [field]: value,
      });
    },
  };
}

interface RecentEntry {
  lastOpened: number;
  path: string;
}

const isRecentList = (v: unknown): v is RecentEntry[] =>
  Array.isArray(v) &&
  v.every(
    (e) => isRecord(e) && isString(e.path) && typeof e.lastOpened === "number",
  );

const isLocal = (e: Record<string, unknown>) =>
  e.hostId === undefined || e.hostId === LOCAL_HOST_ID;

/**
 * This Mac's recent projects. Entries for paired hosts name another machine's
 * disk, so they stay in the renderer.
 */
const recentProjects: PrefBinding = {
  local: "argus:recentProjects",
  host: { uiState: "home.recent_projects" },
  read: (raw) => {
    const list = parse(raw);
    if (!Array.isArray(list)) {
      return undefined;
    }

    return list
      .filter(isRecord)
      .filter(isLocal)
      .filter((e) => isString(e.path) && typeof e.lastOpened === "number")
      .map((e) => ({ path: e.path, lastOpened: e.lastOpened }));
  },
  write: (value, raw) => {
    if (!isRecentList(value)) {
      return undefined;
    }
    const current = parse(raw);
    const remote = Array.isArray(current)
      ? current.filter(isRecord).filter((e) => !isLocal(e))
      : [];
    const local = value.map((e) => ({
      path: e.path,
      lastOpened: e.lastOpened,
      hostId: LOCAL_HOST_ID,
      name: e.path.split(/[/\\]/).filter(Boolean).pop() ?? e.path,
    }));

    return JSON.stringify([...local, ...remote]);
  },
};

export const PREF_BINDINGS: PrefBinding[] = [
  plain(
    "argus:theme",
    { setting: "theme" },
    oneOf(["dark", "light", "system"]),
  ),
  plain(
    "argus:ui-scale",
    { setting: "ui_scale" },
    oneOf(["default", "large", "larger", "small", "smaller"]),
  ),
  settingsField(
    "defaultPermissionMode",
    "default_permission_mode",
    oneOf(["ask", "auto", "plan", "review", "trusted"]),
  ),
  settingsField("defaultModel", "default_model", isString),
  settingsField(
    "customEditors",
    "custom_editors",
    (v) =>
      Array.isArray(v) &&
      v.every(
        (e) =>
          isRecord(e) &&
          isString(e.id) &&
          isString(e.name) &&
          isString(e.command),
      ),
  ),
  settingsField("huddleDisplayName", "huddle_display_name", isString),
  settingsField("telemetryMode", "telemetry_mode", oneOf(["full", "presence"])),
  settingsField(
    "defaultLlm",
    "default_llm",
    (v) =>
      isRecord(v) &&
      (v.runner === null || isString(v.runner)) &&
      (v.model === null || isString(v.model)),
  ),
  settingsField("workingCopyView", "git_file_view", oneOf(["flat", "tree"])),
  settingsField("diffView", "git_diff_layout", oneOf(["split", "unified"])),
  settingsField("diffWhitespace", "git_ignore_whitespace", isBool),
  plain(
    "argus:platform",
    { uiState: "runtime.platform" },
    oneOf(["android", "ios", "video", "web"]),
  ),
  json(
    "argus:simulatorBySession",
    { uiState: "runtime.ios_by_session" },
    isStringMap,
  ),
  json(
    "argus:androidBySession",
    { uiState: "runtime.android_by_session" },
    isStringMap,
  ),
  json(
    "argus:videoBySession",
    { uiState: "runtime.video_by_session" },
    isStringMap,
  ),
  plain("argus:browserPreset", { uiState: "runtime.browser_preset" }),
  json(
    "argus:git-favorites",
    { uiState: "git.favorites" },
    (v) =>
      isRecord(v) &&
      isRecord(v.byRepo) &&
      Object.values(v.byRepo).every(
        (l) => Array.isArray(l) && l.every(isString),
      ),
  ),
  plain(
    "argus:devices:viewMode",
    { uiState: "devices.view_mode" },
    oneOf(["grid", "table"]),
  ),
  {
    local: "argus:devices:gridTileSize",
    host: { uiState: "devices.tile_size" },
    read: (raw) => (Number.isFinite(Number(raw)) ? Number(raw) : undefined),
    write: (value) => (typeof value === "number" ? String(value) : undefined),
  },
  recentProjects,
  json(
    "argus:hiddenProjects",
    { uiState: "home.hidden_projects" },
    (v) => Array.isArray(v) && v.every(isString),
  ),
];
