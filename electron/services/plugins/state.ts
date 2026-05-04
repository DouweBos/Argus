/**
 * Backend mirror of the renderer's plugin enable/disable state.
 *
 * Persisted at `~/.argus/plugins.json`. The renderer is authoritative — it
 * pushes the enabled set on every change via the `set_enabled_plugins` IPC
 * command. Backend reads from disk on boot (so handlers know "is X on?"
 * before the renderer is ready) and writes through to disk on every update.
 *
 * Defaults seed from the registry's `defaultEnabled` flags. We do NOT mirror
 * the project mask here — handlers look up the active session's project and
 * combine the two (chunk 9 wires that path).
 */

import type { PluginId } from "./types";
import fs from "node:fs";
import path from "node:path";
import { warn } from "../../../app/lib/logger";
import { argusDirPath, ensureArgusDir } from "../onboarding/state";
import { PLUGIN_IDS } from "./types";

interface PluginsConfigFile {
  version: number;
  /** Per-plugin user toggle. Missing entries default to the registry's `defaultEnabled`. */
  userEnabled: Partial<Record<PluginId, boolean>>;
}

const SCHEMA_VERSION = 1;

function pluginsFilePath(): string {
  return path.join(argusDirPath(), "plugins.json");
}

function isPluginId(id: string): id is PluginId {
  return (PLUGIN_IDS as readonly string[]).includes(id);
}

let cache: PluginsConfigFile | null = null;

/**
 * Default-enabled defaults from the registry. We replicate them here as a
 * static map rather than importing the renderer registry — main process can't
 * pull React-flavored modules. Keep this in sync with `app/plugins/registry.ts`
 * (the chunk-12 flip touches both).
 */
const DEFAULT_ENABLED: Record<PluginId, boolean> = {
  "device-recording": false,
  "device-inspector": false,
  "device-control": false,
  "device-debug": false,
};

function load(): PluginsConfigFile {
  if (cache) {
    return cache;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(pluginsFilePath(), "utf8");
  } catch {
    cache = { version: SCHEMA_VERSION, userEnabled: {} };

    return cache;
  }

  let parsed: Partial<PluginsConfigFile>;
  try {
    parsed = JSON.parse(raw) as Partial<PluginsConfigFile>;
  } catch (e) {
    warn("Failed to parse plugins.json:", e);
    parsed = {};
  }

  const userEnabled: Partial<Record<PluginId, boolean>> = {};
  for (const [id, value] of Object.entries(parsed.userEnabled ?? {})) {
    if (typeof value === "boolean" && isPluginId(id)) {
      userEnabled[id] = value;
    }
  }
  cache = { version: SCHEMA_VERSION, userEnabled };

  return cache;
}

function save(cfg: PluginsConfigFile): void {
  ensureArgusDir();
  const filePath = pluginsFilePath();
  const json = JSON.stringify(cfg, null, 2);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, json, "utf8");
  fs.renameSync(tmp, filePath);
  cache = cfg;
}

/** Force a re-read on next access. Used by tests. */
export function __resetPluginsStateForTests(): void {
  cache = null;
}

/** Effective user-toggle (no `requires` walk; see `pluginEnabled` for that). */
function isUserEnabled(id: PluginId): boolean {
  const explicit = load().userEnabled[id];
  if (typeof explicit === "boolean") {
    return explicit;
  }

  return DEFAULT_ENABLED[id];
}

/** Walks `requires` to determine if the plugin is actually usable. */
const REQUIRES: Record<PluginId, PluginId[]> = {
  "device-recording": [],
  "device-inspector": ["device-recording"],
  "device-control": [],
  "device-debug": ["device-control"],
};

/**
 * Is the named plugin currently enabled? IPC handlers wrap their bodies in
 * `if (!pluginEnabled(...)) throw "plugin disabled"` — so this is the gate.
 *
 * NOTE: this does NOT consult the project mask. The project mask is read by
 * the IPC layer from the active session's `ArgusConfig` (chunk 9).
 */
export function pluginEnabled(id: PluginId): boolean {
  if (!isUserEnabled(id)) {
    return false;
  }
  for (const dep of REQUIRES[id]) {
    if (!pluginEnabled(dep)) {
      return false;
    }
  }

  return true;
}

/** Bulk update — called by the renderer's IPC sync after the user toggles. */
export function setEnabledPluginsFromRenderer(
  next: Partial<Record<PluginId, boolean>>,
): void {
  const sanitized: Partial<Record<PluginId, boolean>> = {};
  for (const [id, value] of Object.entries(next)) {
    if (typeof value === "boolean" && isPluginId(id)) {
      sanitized[id] = value;
    }
  }
  save({ version: SCHEMA_VERSION, userEnabled: sanitized });
}

/** Read the persisted user-enabled map. Renderer reads this on startup. */
export function getEnabledPluginsForRenderer(): Partial<
  Record<PluginId, boolean>
> {
  return { ...load().userEnabled };
}
