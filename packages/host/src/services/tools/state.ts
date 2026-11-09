/**
 * Backend mirror of the renderer's tool enable/disable state.
 *
 * Persisted at `~/.argus/tools.json`. The renderer is authoritative — it
 * pushes the enabled set on every change via the `set_enabled_tools` IPC
 * command. Backend reads from disk on boot (so handlers know "is X on?"
 * before the renderer is ready) and writes through to disk on every update.
 *
 * Defaults seed from the registry's `defaultEnabled` flags. We do NOT mirror
 * the project mask here — handlers look up the active session's project and
 * combine the two.
 */

import type { ToolId } from "./types";
import fs from "node:fs";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { argusDirPath, ensureArgusDir } from "../onboarding/state";
import { TOOL_IDS } from "./types";

interface ToolsConfigFile {
  version: number;
  /** Per-tool user toggle. Missing entries default to the registry's `defaultEnabled`. */
  userEnabled: Partial<Record<ToolId, boolean>>;
}

const SCHEMA_VERSION = 1;

function toolsFilePath(): string {
  return path.join(argusDirPath(), "tools.json");
}

function isToolId(id: string): id is ToolId {
  return (TOOL_IDS as readonly string[]).includes(id);
}

let cache: ToolsConfigFile | null = null;

/**
 * Default-enabled defaults. Keep this in sync with `defaultEnabled` in
 * ArgusCore's `DesktopTool.all`.
 */
const DEFAULT_ENABLED: Record<ToolId, boolean> = {
  "device-recording": true,
  "device-inspector": true,
  "device-control": true,
  "device-debug": true,
};

function load(): ToolsConfigFile {
  if (cache) {
    return cache;
  }

  const filePath = toolsFilePath();

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    cache = { version: SCHEMA_VERSION, userEnabled: {} };

    return cache;
  }

  let parsed: Partial<ToolsConfigFile>;
  try {
    parsed = JSON.parse(raw) as Partial<ToolsConfigFile>;
  } catch (e) {
    warn("Failed to parse tools.json:", e);
    parsed = {};
  }

  const userEnabled: Partial<Record<ToolId, boolean>> = {};
  for (const [id, value] of Object.entries(parsed.userEnabled ?? {})) {
    if (typeof value === "boolean" && isToolId(id)) {
      userEnabled[id] = value;
    }
  }
  cache = { version: SCHEMA_VERSION, userEnabled };

  return cache;
}

function save(cfg: ToolsConfigFile): void {
  ensureArgusDir();
  const filePath = toolsFilePath();
  const json = JSON.stringify(cfg, null, 2);
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, json, "utf8");
  fs.renameSync(tmp, filePath);
  cache = cfg;
}

/** Force a re-read on next access. Used by tests. */
export function __resetToolsStateForTests(): void {
  cache = null;
}

/** Effective user-toggle (no `requires` walk; see `toolEnabled` for that). */
function isUserEnabled(id: ToolId): boolean {
  const explicit = load().userEnabled[id];
  if (typeof explicit === "boolean") {
    return explicit;
  }

  return DEFAULT_ENABLED[id];
}

/** Walks `requires` to determine if the tool is actually usable. */
const REQUIRES: Record<ToolId, ToolId[]> = {
  "device-recording": [],
  "device-inspector": ["device-recording"],
  "device-control": [],
  "device-debug": ["device-control"],
};

/**
 * Is the named tool currently enabled? IPC handlers wrap their bodies in
 * `if (!toolEnabled(...)) throw "tool disabled"` — so this is the gate.
 *
 * NOTE: this does NOT consult the project mask. The project mask is read by
 * the IPC layer from the active session's `ArgusConfig`.
 */
export function toolEnabled(id: ToolId): boolean {
  if (!isUserEnabled(id)) {
    return false;
  }
  for (const dep of REQUIRES[id]) {
    if (!toolEnabled(dep)) {
      return false;
    }
  }

  return true;
}

/** Bulk update — called by the renderer's IPC sync after the user toggles. */
export function setEnabledToolsFromRenderer(
  next: Partial<Record<string, boolean>>,
): void {
  const sanitized: Partial<Record<ToolId, boolean>> = {};
  for (const [id, value] of Object.entries(next)) {
    if (typeof value === "boolean" && isToolId(id)) {
      sanitized[id] = value;
    }
  }
  save({ version: SCHEMA_VERSION, userEnabled: sanitized });
}

/** Read the persisted user-enabled map. Renderer reads this on startup. */
export function getEnabledToolsForRenderer(): Partial<Record<ToolId, boolean>> {
  return { ...load().userEnabled };
}
