/**
 * Machine-local app settings stored at `~/.argus/app-settings.json`.
 *
 * Holds preferences that need to be readable from the main process (so they
 * can affect how subprocesses are spawned) and persisted across app restarts.
 * Per-developer; never written into the repository.
 */

import type { McpServers } from "../mcp/userConfig";
import fs from "node:fs";
import path from "node:path";
import { warn } from "../../../app/lib/logger";
import { argusHomeDir } from "../../lib/argusHome";

const SCHEMA_VERSION = 1;

export interface AppSettings {
  /** User-defined MCP servers merged into every spawned agent. */
  mcp_servers?: McpServers;
  /**
   * Auto-updater feed channel. `latest` is the public production feed; `beta`
   * subscribes to in-development builds cut from `main`. Defaults to `latest`.
   * Mirrored to/from the renderer settings store. Alpha builds (one-off
   * builds from any branch) are not subscribable here — they're installed
   * manually from the GitHub release page by repo collaborators.
   */
  updater_channel?: "beta" | "latest";
}

interface AppSettingsFile {
  version: number;
  settings: AppSettings;
}

function filePath(): string {
  return path.join(argusHomeDir(), "app-settings.json");
}

function readFile(): AppSettingsFile {
  const empty: AppSettingsFile = { version: SCHEMA_VERSION, settings: {} };

  let raw: string;
  try {
    raw = fs.readFileSync(filePath(), "utf8");
  } catch {
    return empty;
  }

  try {
    const parsed = JSON.parse(raw) as AppSettingsFile;
    if (parsed.version !== SCHEMA_VERSION || !parsed.settings) {
      return empty;
    }

    return parsed;
  } catch (e) {
    warn("Failed to parse app-settings.json:", e);

    return empty;
  }
}

function writeFile(file: AppSettingsFile): void {
  const target = filePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2), "utf8");
  fs.renameSync(tmp, target);
}

export function loadAppSettings(): AppSettings {
  return readFile().settings;
}

export function saveAppSettings(settings: AppSettings): AppSettings {
  const file = readFile();
  file.settings = { ...file.settings, ...settings };
  writeFile(file);

  return file.settings;
}

/** App-level MCP servers, normalised to an empty object if absent. */
export function loadAppMcpServers(): McpServers {
  const servers = loadAppSettings().mcp_servers;
  if (!servers || typeof servers !== "object") {
    return {};
  }

  return servers;
}
