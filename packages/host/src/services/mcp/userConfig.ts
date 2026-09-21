/**
 * Discover and merge the MCP servers that the Claude CLI would normally
 * load from the user's config, their enabled plugins, and the workspace's
 * project-level .mcp.json.
 *
 * When we spawn `claude --mcp-config <json>`, the inline JSON config
 * replaces the CLI's plugin-sourced MCP discovery — so agents lose access
 * to things like the Linear MCP that ship with enabled plugins (e.g.
 * plex-tools). Merge them back in ourselves.
 */

import { readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { warn } from "@argus/host/logger";
import { loadAppMcpServers } from "../appSettings/store";
import { loadArgusConfig } from "../session/argusConfig";
import { getActiveAccessToken } from "./oauth";

type McpServerConfig = Record<string, unknown>;
export type McpServers = Record<string, McpServerConfig>;

function readJson<T>(file: string): T | null {
  try {
    if (!existsSync(file)) {
      return null;
    }

    return JSON.parse(readFileSync(file, "utf-8")) as T;
  } catch (err) {
    warn(`[mcp] failed to read ${file}: ${(err as Error).message}`);

    return null;
  }
}

function extractMcpServers(obj: unknown): McpServers {
  if (!obj || typeof obj !== "object") {
    return {};
  }
  const servers = (obj as { mcpServers?: unknown }).mcpServers;
  if (!servers || typeof servers !== "object") {
    return {};
  }

  return servers as McpServers;
}

/**
 * MCP servers from `~/.claude.json` — both top-level and the per-project
 * entry keyed by the worktree path (if present).
 */
function collectFromUserClaudeJson(worktreePath: string): McpServers {
  const data = readJson<{
    mcpServers?: McpServers;
    projects?: Record<string, { mcpServers?: McpServers }>;
  }>(path.join(os.homedir(), ".claude.json"));
  if (!data) {
    return {};
  }
  const merged: McpServers = { ...(data.mcpServers ?? {}) };
  const projectEntry = data.projects?.[worktreePath];
  if (projectEntry?.mcpServers) {
    Object.assign(merged, projectEntry.mcpServers);
  }

  return merged;
}

/**
 * MCP servers from every enabled plugin's `.mcp.json`. Plugin install
 * paths come from `~/.claude/plugins/installed_plugins.json`; we only
 * load plugins that are flipped on in `~/.claude/settings.json`.
 */
function collectFromEnabledPlugins(): McpServers {
  const home = os.homedir();
  const settings = readJson<{ enabledPlugins?: Record<string, boolean> }>(
    path.join(home, ".claude", "settings.json"),
  );
  const enabled = settings?.enabledPlugins ?? {};
  const enabledNames = Object.keys(enabled).filter((k) => enabled[k]);
  if (enabledNames.length === 0) {
    return {};
  }

  const installed = readJson<{
    plugins?: Record<string, { installPath?: string }[]>;
  }>(path.join(home, ".claude", "plugins", "installed_plugins.json"));
  const pluginMap = installed?.plugins ?? {};

  const merged: McpServers = {};
  for (const name of enabledNames) {
    const entries = pluginMap[name];
    if (!entries || entries.length === 0) {
      continue;
    }
    const installPath = entries[entries.length - 1].installPath;
    if (!installPath) {
      continue;
    }
    const pluginMcp = readJson<{ mcpServers?: McpServers }>(
      path.join(installPath, ".mcp.json"),
    );
    if (pluginMcp?.mcpServers) {
      Object.assign(merged, pluginMcp.mcpServers);
    }
  }

  return merged;
}

/** Project-level `.mcp.json` checked into the worktree. */
function collectFromWorktree(worktreePath: string): McpServers {
  const data = readJson<{ mcpServers?: McpServers }>(
    path.join(worktreePath, ".mcp.json"),
  );

  return extractMcpServers(data);
}

/** Project-level `mcp_servers` declared inside the worktree's `.argus.json`. */
function collectFromArgusConfig(worktreePath: string): McpServers {
  try {
    const config = loadArgusConfig(worktreePath);

    return (config.mcp_servers as McpServers | null) ?? {};
  } catch (err) {
    warn(
      `[mcp] failed to read .argus.json mcp_servers: ${(err as Error).message}`,
    );

    return {};
  }
}

/**
 * A single MCP server entry annotated with where it came from. Used by the
 * Settings UIs to show users which servers Argus already inherits before
 * they add their own.
 */
export interface InheritedMcpServer {
  /** Server name (the key inside `mcpServers`). */
  name: string;
  /** Server config — opaque object passed straight through to Claude Code. */
  config: Record<string, unknown>;
  /** Where the entry came from (e.g. `"plugin:plex-tools"`, `".mcp.json"`). */
  source: string;
}

/**
 * Enumerate MCP servers that Argus inherits without the user touching any
 * Argus setting — i.e. plugins, `~/.claude.json`, and the project's
 * `.mcp.json`. Each entry carries a `source` label so the UI can group them.
 *
 * When `worktreePath` is omitted (e.g. from the global App Settings dialog)
 * the project-scoped sources are skipped.
 */
export function listInheritedMcpServers(
  worktreePath?: string | null,
): InheritedMcpServer[] {
  const out: InheritedMcpServer[] = [];

  // Plugins — preserve per-plugin attribution.
  const home = os.homedir();
  const settings = readJson<{ enabledPlugins?: Record<string, boolean> }>(
    path.join(home, ".claude", "settings.json"),
  );
  const enabled = settings?.enabledPlugins ?? {};
  const installed = readJson<{
    plugins?: Record<string, { installPath?: string }[]>;
  }>(path.join(home, ".claude", "plugins", "installed_plugins.json"));
  const pluginMap = installed?.plugins ?? {};
  for (const pluginName of Object.keys(enabled).filter((k) => enabled[k])) {
    const entries = pluginMap[pluginName];
    const installPath = entries?.[entries.length - 1]?.installPath;
    if (!installPath) {
      continue;
    }
    const pluginMcp = readJson<{ mcpServers?: McpServers }>(
      path.join(installPath, ".mcp.json"),
    );
    for (const [name, config] of Object.entries(pluginMcp?.mcpServers ?? {})) {
      out.push({ name, config, source: `plugin:${pluginName}` });
    }
  }

  // ~/.claude.json — top-level entries, then per-project entries.
  const claudeJson = readJson<{
    mcpServers?: McpServers;
    projects?: Record<string, { mcpServers?: McpServers }>;
  }>(path.join(home, ".claude.json"));
  for (const [name, config] of Object.entries(claudeJson?.mcpServers ?? {})) {
    out.push({ name, config, source: "~/.claude.json" });
  }
  if (worktreePath) {
    const projectEntry = claudeJson?.projects?.[worktreePath];
    for (const [name, config] of Object.entries(
      projectEntry?.mcpServers ?? {},
    )) {
      out.push({ name, config, source: "~/.claude.json (project)" });
    }
  }

  // Worktree .mcp.json.
  if (worktreePath) {
    const worktreeMcp = readJson<{ mcpServers?: McpServers }>(
      path.join(worktreePath, ".mcp.json"),
    );
    for (const [name, config] of Object.entries(
      worktreeMcp?.mcpServers ?? {},
    )) {
      out.push({ name, config, source: ".mcp.json" });
    }
  }

  return out;
}

/**
 * Inject any Argus-managed OAuth bearer tokens into HTTP MCP server entries.
 * Mutates the input map in place and returns it. We only fill in
 * `headers.Authorization` when the entry doesn't already specify one — so
 * a config that hard-codes a token wins.
 */
async function injectStoredTokens(servers: McpServers): Promise<McpServers> {
  for (const [, config] of Object.entries(servers)) {
    if (!config || typeof config !== "object") {
      continue;
    }
    const url = (config as { url?: unknown }).url;
    if (typeof url !== "string") {
      continue;
    }
    const existingHeaders =
      (config as { headers?: Record<string, unknown> }).headers ?? {};
    const hasAuth = Object.keys(existingHeaders).some(
      (k) => k.toLowerCase() === "authorization",
    );
    if (hasAuth) {
      continue;
    }
    try {
      const token = await getActiveAccessToken(url);
      if (token) {
        (config as { headers?: Record<string, unknown> }).headers = {
          ...existingHeaders,
          Authorization: `Bearer ${token}`,
        };
      }
    } catch (err) {
      warn(
        `[mcp] failed to load stored token for ${url}: ${(err as Error).message}`,
      );
    }
  }

  return servers;
}

/**
 * Build the merged `mcpServers` map for a spawned agent.
 *
 * Precedence (later wins): plugins < user ~/.claude.json < worktree .mcp.json
 * < app settings (~/.argus/app-settings.json) < project .argus.json mcp_servers
 * < explicit overrides (e.g. the Argus MCP server itself).
 *
 * Async because we transparently inject any OAuth bearer tokens the user
 * has stored via the Argus auth flow.
 */
export async function buildMergedMcpServers(
  worktreePath: string,
  overrides: McpServers = {},
): Promise<McpServers> {
  const merged: McpServers = {
    ...collectFromEnabledPlugins(),
    ...collectFromUserClaudeJson(worktreePath),
    ...collectFromWorktree(worktreePath),
    ...loadAppMcpServers(),
    ...collectFromArgusConfig(worktreePath),
    ...overrides,
  };

  return injectStoredTokens(merged);
}
