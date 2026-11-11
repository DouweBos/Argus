/**
 * A project's effective config: the checked-in `.argus.json` (if any) with
 * the config stored on this machine layered over it. Everything that reads
 * project config goes through `loadArgusConfig`.
 *
 * Split out of `setup.ts` — the setup pipeline needs a terminal and the
 * terminal needs the config, so keeping both in one file was a cycle.
 */

import fs from "node:fs";
import path from "node:path";
import { info, warn } from "@argus/host/logger";
import { emitHostEvent } from "../../bus";
import { appState } from "../../state";
import { capture } from "../telemetry/telemetry";
import {
  type HostArgusConfig,
  loadHostArgusConfig,
  saveHostArgusConfig,
} from "../userProjectSettings/store";
import {
  applyDefaults,
  mergeConfig,
  parseArgusConfig,
} from "./argusConfigParse";
import { type ArgusConfig, defaultArgusConfig } from "./models";

type RawConfig = Record<string, unknown>;

/** A project's config as the Project Settings sheet shows it. */
export interface ProjectConfig {
  /** The effective config, in `.argus.json` format. */
  config: RawConfig;
  /** Whether the repo has a checked-in `.argus.json`. */
  repo_file: boolean;
  /** Top-level keys the checked-in `.argus.json` sets. */
  repo_keys: string[];
  /** Top-level keys stored on this machine. */
  host_keys: string[];
}

/** Every key `parseArgusConfig` owns, by the name it has in the parsed config. */
const CONFIG_KEYS = new Set(Object.keys(defaultArgusConfig()));

/** `workspace_port_env` is the old name of `workspace_env`. */
function configKey(key: string): string {
  return key === "workspace_port_env" ? "workspace_env" : key;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * The effective config for a repo root or one of its worktrees: the dir's
 * `.argus.json` with the project's stored config merged over it. Returns the
 * default (empty) config if neither exists.
 */
export function loadArgusConfig(dir: string): ArgusConfig {
  const root = projectRootFor(dir);
  const repoRaw = readRepoRaw(dir);
  let config = repoRaw ? parseRepo(repoRaw, dir) : defaultArgusConfig();

  const hostRaw = hostLayer(root);
  if (hostRaw) {
    try {
      config = mergeConfig(config, parseArgusConfig(hostRaw, root));
    } catch (e) {
      throw `Failed to read the project config stored on this Mac: ${e}`;
    }
  }

  return applyDefaults(config);
}

/**
 * Return true when `branch` is listed as a protected branch in the project's
 * config. Used to gate the direct merge flow.
 */
export function isBranchProtected(
  repoRoot: string,
  branch: string | null | undefined,
): boolean {
  if (!branch) {
    return false;
  }
  try {
    return loadArgusConfig(repoRoot).protected_branches.includes(branch);
  } catch {
    return false;
  }
}

/** A worktree's project root, so it shares its project's stored config. */
function projectRootFor(dir: string): string {
  const resolved = path.resolve(dir);
  for (const session of appState.sessions.values()) {
    if (session.path && path.resolve(session.path) === resolved) {
      return session.repo_root;
    }
  }

  return dir;
}

function readRepoRaw(dir: string): RawConfig | null {
  const configPath = path.join(dir, ".argus.json");
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    return asObject(JSON.parse(fs.readFileSync(configPath, "utf8")));
  } catch (e) {
    throw `Failed to read/parse .argus.json: ${e}`;
  }
}

function parseRepo(raw: RawConfig, dir: string): ArgusConfig {
  try {
    return parseArgusConfig(raw, dir);
  } catch (e) {
    throw `Failed to read/parse .argus.json: ${e}`;
  }
}

function asObject(value: unknown): RawConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw "expected a JSON object";
  }

  return value as RawConfig;
}

/**
 * The project's stored config. A project with a `.argus.local.json` and
 * nothing stored yet has that file imported once, after which it's ignored.
 */
function hostLayer(root: string): HostArgusConfig | undefined {
  const stored = loadHostArgusConfig(root);
  if (stored !== undefined) {
    return stored;
  }

  const localPath = path.join(root, ".argus.local.json");
  if (!fs.existsSync(localPath)) {
    return undefined;
  }
  let local: RawConfig;
  try {
    local = asObject(JSON.parse(fs.readFileSync(localPath, "utf8")));
    parseArgusConfig(local, root);
  } catch (e) {
    warn(`Not importing ${localPath}: ${e}`);
    capture("project_config_local_migrated", { success: false });

    return undefined;
  }
  saveHostArgusConfig(root, local);
  info(
    `Imported ${localPath} into the project config stored on this Mac; the file is no longer read`,
  );
  capture("project_config_local_migrated", { success: true });

  return local;
}

// ---------------------------------------------------------------------------
// The layers, for Project Settings
// ---------------------------------------------------------------------------

/** The effective config and where each top-level key comes from. */
export function getProjectConfig(repoRoot: string): ProjectConfig {
  const repoRaw = readRepoRaw(repoRoot);
  const hostRaw = hostLayer(repoRoot) ?? {};
  const effective = loadArgusConfig(repoRoot);

  return {
    config: {
      ...unknownKeys(repoRaw ?? {}),
      ...unknownKeys(hostRaw),
      ...toRaw(effective),
    },
    repo_file: repoRaw !== null,
    repo_keys: Object.keys(repoRaw ?? {}).map(configKey),
    host_keys: Object.keys(hostRaw).map(configKey),
  };
}

/**
 * Store `desired` as this project's config. A key is stored when it's in
 * `edited` or already stored, even if it matches the checked-in `.argus.json`,
 * so what the user set stays set; keys nobody touched keep following the repo.
 */
export function saveProjectConfig(
  repoRoot: string,
  desired: RawConfig,
  edited: string[],
): ProjectConfig {
  parseArgusConfig(desired, repoRoot);
  const keep = new Set(
    [...edited, ...Object.keys(hostLayer(repoRoot) ?? {})].map(configKey),
  );

  const layer: RawConfig = {};
  for (const [key, value] of Object.entries(desired)) {
    if (value !== null && value !== undefined && keep.has(configKey(key))) {
      layer[key] = value;
    }
  }

  saveHostArgusConfig(repoRoot, layer);
  emitHostEvent("argus_config:changed", { repoRoot });

  return getProjectConfig(repoRoot);
}

/** The effective config as `.argus.json` text. */
export function exportProjectConfig(repoRoot: string): string {
  const project = getProjectConfig(repoRoot);
  capture("project_config_transferred", {
    action: "export",
    outcome: "success",
    repo_file: project.repo_file,
  });

  return `${JSON.stringify(project.config, null, 2)}\n`;
}

/**
 * Replace this project's stored config with an `.argus.json`-format file's
 * contents. Every key in the file is stored, matching the repo file or not.
 */
export function importProjectConfig(
  repoRoot: string,
  content: string,
): ProjectConfig {
  const repoFile = fs.existsSync(path.join(repoRoot, ".argus.json"));
  const fail = (outcome: "invalid_config" | "invalid_json", e: unknown) => {
    capture("project_config_transferred", {
      action: "import",
      outcome,
      repo_file: repoFile,
    });

    return outcome === "invalid_json"
      ? `Not a valid .argus.json: ${e}`
      : `Invalid project config: ${e}`;
  };

  let parsed: RawConfig;
  try {
    parsed = asObject(JSON.parse(content));
  } catch (e) {
    throw fail("invalid_json", e);
  }
  try {
    parseArgusConfig(parsed, repoRoot);
  } catch (e) {
    throw fail("invalid_config", e);
  }

  saveHostArgusConfig(repoRoot, withoutNulls(parsed));
  emitHostEvent("argus_config:changed", { repoRoot });
  const result = getProjectConfig(repoRoot);
  capture("project_config_transferred", {
    action: "import",
    outcome: "success",
    repo_file: repoFile,
  });

  return result;
}

/** Keys Argus doesn't read, kept so they survive a round trip. */
function unknownKeys(raw: RawConfig): RawConfig {
  return Object.fromEntries(
    Object.entries(raw).filter(([key]) => !CONFIG_KEYS.has(configKey(key))),
  );
}

/** A parsed config in `.argus.json` format, without empty or default values. */
function toRaw(config: ArgusConfig): RawConfig {
  const out: RawConfig = {};
  const setup = Object.fromEntries(
    Object.entries(config.setup).filter(([, v]) => !isEmpty(v)),
  );
  if (!isEmpty(setup)) {
    out.setup = setup;
  }
  for (const [key, value] of Object.entries(config)) {
    if (key === "setup" || isEmpty(value) || value === false) {
      continue;
    }
    out[key] = value;
  }

  return out;
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return typeof value === "object" && Object.keys(value).length === 0;
}

function withoutNulls(raw: RawConfig): RawConfig {
  return Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== null && v !== undefined),
  );
}
