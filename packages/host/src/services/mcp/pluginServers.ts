/**
 * MCP servers that the Claude CLI loads from plugins: the ones installed
 * from a marketplace and the ones an organization syncs to the machine.
 * Read for display only; agents get plugin servers from the CLI itself.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { warn } from "@argus/host/logger";

export interface PluginMcpServer {
  name: string;
  config: Record<string, unknown>;
  plugin: string;
}

interface SyncedManifest {
  plugins?: { name?: string; generation?: number }[];
}

function readJson<T>(file: string): T | null {
  try {
    return existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf-8")) as T)
      : null;
  } catch (err) {
    warn(`[mcp] failed to read ${file}: ${(err as Error).message}`);

    return null;
  }
}

function serversIn(dir: string): [string, Record<string, unknown>][] {
  const data = readJson<{
    mcpServers?: Record<string, Record<string, unknown>>;
  }>(path.join(dir, ".mcp.json"));

  return Object.entries(data?.mcpServers ?? {});
}

/** `plex-tools`, `plex-tools~g2` — a later sync generation lives under a suffix. */
function syncedDir(
  bucket: string,
  name: string,
  generation?: number,
): string | null {
  const candidates = [
    ...(generation && generation > 1 ? [`${name}~g${generation}`] : []),
    name,
    ...listDirs(bucket)
      .filter((d) => d.startsWith(`${name}~g`))
      .sort()
      .reverse(),
  ];
  const found = candidates.find((d) => existsSync(path.join(bucket, d)));

  return found ? path.join(bucket, found) : null;
}

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export function listPluginMcpServers(home = os.homedir()): PluginMcpServer[] {
  const pluginsDir = path.join(home, ".claude", "plugins");
  const enabled =
    readJson<{ enabledPlugins?: Record<string, boolean> }>(
      path.join(home, ".claude", "settings.json"),
    )?.enabledPlugins ?? {};
  const out: PluginMcpServer[] = [];
  const seen = new Set<string>();

  const installed =
    readJson<{ plugins?: Record<string, { installPath?: string }[]> }>(
      path.join(pluginsDir, "installed_plugins.json"),
    )?.plugins ?? {};
  for (const id of Object.keys(enabled).filter((k) => enabled[k])) {
    const installPath = installed[id]?.at(-1)?.installPath;
    if (!installPath) {
      continue;
    }
    seen.add(id.split("@")[0]);
    for (const [name, config] of serversIn(installPath)) {
      out.push({ name, config, plugin: id });
    }
  }

  // Synced plugins are on unless switched off, and the CLI names them `<plugin>@synced`.
  const synced = path.join(pluginsDir, "synced");
  for (const bucket of listDirs(synced).map((b) => path.join(synced, b))) {
    for (const entry of readJson<SyncedManifest>(
      path.join(bucket, "manifest.json"),
    )?.plugins ?? []) {
      const name = entry.name;
      if (!name || seen.has(name) || enabled[`${name}@synced`] === false) {
        continue;
      }
      const dir = syncedDir(bucket, name, entry.generation);
      if (!dir) {
        continue;
      }
      seen.add(name);
      for (const [server, config] of serversIn(dir)) {
        out.push({ name: server, config, plugin: name });
      }
    }
  }

  return out;
}
