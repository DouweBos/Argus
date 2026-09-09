/**
 * `.argus.json` config loading, merging, and the worktree setup pipeline
 * (copy, symlink, commands).
 */

import fg from "fast-glob";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { info, warn } from "../../../app/lib/logger";
import { getMainWindow } from "../../mainWindow";
import { appState } from "../../state";
import {
  createTerminal,
  setupShellCommand,
  stripAnsi,
} from "../terminal/multiplexer";
import {
  type BrowserPresetConfig,
  defaultArgusConfig,
  type LlmConfig,
  type RelatedProject,
  type ReleaseNoteFormat,
  type ReleaseNoteLabelConfig,
  type ReleaseNoteLabelTone,
  type ReleaseNotePatternConfig,
  type RunCommand,
  type SetupConfig,
  type SetupCopyEntry,
  type SimulatorDeeplinkConfig,
  type ArgusConfig,
  type WorkspaceEnvConfig,
  setupEntryExcludes,
  setupEntryPath,
} from "./models";

const execFileAsync = promisify(execFile);

/** Give up on a setup command that has been silent this long (ms). */
const SETUP_IDLE_TIMEOUT_MS = 20 * 60 * 1000;

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

/**
 * Load `.argus.json` from `repoRoot`, then merge `.argus.local.json`
 * on top if it exists. Returns a default (empty) config if neither file exists.
 */
export function loadArgusConfig(repoRoot: string): ArgusConfig {
  const configPath = path.join(repoRoot, ".argus.json");
  let config: ArgusConfig = defaultArgusConfig();

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf8");
      config = parseArgusConfig(raw, repoRoot);
    } catch (e) {
      throw `Failed to read/parse .argus.json: ${e}`;
    }
  }

  const localPath = path.join(repoRoot, ".argus.local.json");
  if (fs.existsSync(localPath)) {
    try {
      const raw = fs.readFileSync(localPath, "utf8");
      const local = parseArgusConfig(raw, repoRoot);
      config = mergeConfig(config, local);
    } catch (e) {
      throw `Failed to read/parse .argus.local.json: ${e}`;
    }
  }

  return config;
}

/**
 * Normalise `workspace_env` from its possible JSON forms into an array.
 * Accepts: null/undefined, a single object, or an array.
 */
function normalizeWorkspaceEnv(raw: unknown): WorkspaceEnvConfig[] {
  if (raw == null) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw as WorkspaceEnvConfig[];
  }
  if (typeof raw === "object") {
    return [raw as WorkspaceEnvConfig];
  }

  return [];
}

/**
 * Parse raw JSON into a `ArgusConfig`. The `run` field must be an array of
 * `RunCommand` objects — the old string / single-object form is rejected.
 */
function parseArgusConfig(raw: string, repoRoot: string): ArgusConfig {
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const setup = (parsed.setup as Partial<SetupConfig>) ?? {};
  const run = normalizeRunCommands(parsed.run, repoRoot);

  return {
    setup: {
      copy: normalizeSetupEntries(setup.copy, repoRoot, "setup.copy"),
      symlink: normalizeSetupEntries(setup.symlink, repoRoot, "setup.symlink"),
      commands: (setup.commands as string[]) ?? [],
    },
    terminals: (parsed.terminals as ArgusConfig["terminals"]) ?? [],
    workspace_env: normalizeWorkspaceEnv(
      parsed.workspace_env ?? parsed.workspace_port_env,
    ),
    run,
    agent_prompt: (parsed.agent_prompt as string) ?? null,
    related_projects: normalizeRelatedProjects(parsed.related_projects),
    browser_url: (parsed.browser_url as string) ?? null,
    browser_presets: normalizeBrowserPresets(parsed.browser_presets),
    save_chat_history:
      parsed.save_chat_history != null
        ? Boolean(parsed.save_chat_history)
        : true,
    platforms: normalizePlatforms(parsed.platforms),
    protected_branches: normalizeProtectedBranches(parsed.protected_branches),
    default_base_branch: normalizeDefaultBaseBranch(parsed.default_base_branch),
    single_runtime:
      parsed.single_runtime != null ? Boolean(parsed.single_runtime) : false,
    mcp_servers: normalizeMcpServers(parsed.mcp_servers),
    min_argus_version: normalizeMinArgusVersion(
      parsed.min_argus_version,
      repoRoot,
    ),
    release_note_patterns: normalizeReleaseNotePatterns(
      parsed.release_note_patterns,
      repoRoot,
    ),
    simulator_deeplinks: normalizeSimulatorDeeplinks(
      parsed.simulator_deeplinks,
      repoRoot,
    ),
    auto_fetch_minutes: normalizeAutoFetchMinutes(parsed.auto_fetch_minutes),
    llm: normalizeLlmConfig(parsed.llm, repoRoot),
    tools: normalizeToolsConfig(parsed.tools),
  };
}

/**
 * Normalise the optional `tools.disabled` list. Anything that isn't a
 * non-empty string is dropped; we don't validate against the registry here
 * because the renderer is what consumes this and unknown ids are harmless.
 */
function normalizeToolsConfig(input: unknown): { disabled?: string[] } | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const disabled = (input as { disabled?: unknown }).disabled;
  if (!Array.isArray(disabled)) {
    return null;
  }
  const cleaned = disabled
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
  if (cleaned.length === 0) {
    return null;
  }

  return { disabled: cleaned };
}

/**
 * Known runner ids for parse-time validation. Unknown ids are NOT a hard
 * fail — the resolver falls back to the app default — but we log a warning
 * so users notice typos before an agent fails to spawn.
 */
const KNOWN_RUNNER_IDS = new Set<string>(["claude-code"]);

/**
 * Normalise the optional `llm` block. Both `runner` and `model` are
 * optional strings; any other shape is rejected with a clear error.
 * Returns `null` when the block is absent or both fields are empty so
 * the resolver cascade can fall through cleanly.
 */
function normalizeLlmConfig(raw: unknown, repoRoot: string): LlmConfig | null {
  if (raw == null) {
    return null;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw `llm in ${repoRoot}/.argus.json must be an object with optional "runner" and "model" string fields.`;
  }
  const obj = raw as Record<string, unknown>;
  let runner: string | null = null;
  if (obj.runner != null) {
    if (typeof obj.runner !== "string") {
      throw `llm.runner in ${repoRoot}/.argus.json must be a string (e.g. "claude-code").`;
    }
    const trimmed = obj.runner.trim();
    if (trimmed) {
      runner = trimmed;
      if (!KNOWN_RUNNER_IDS.has(trimmed)) {
        warn(
          `llm.runner "${trimmed}" in ${repoRoot}/.argus.json is not a known runner id — the resolver will fall back to the app default.`,
        );
      }
    }
  }
  let model: string | null = null;
  if (obj.model != null) {
    if (typeof obj.model !== "string") {
      throw `llm.model in ${repoRoot}/.argus.json must be a string.`;
    }
    const trimmed = obj.model.trim();
    if (trimmed) {
      model = trimmed;
    }
  }
  if (runner == null && model == null) {
    return null;
  }

  return {
    ...(runner != null ? { runner } : {}),
    ...(model != null ? { model } : {}),
  };
}

/**
 * Normalise `simulator_deeplinks`. Each entry is either a leaf
 * `{ label, url }` link or a folder `{ label, children: [...] }` grouping
 * nested entries (folders may contain folders). Empty/missing field is
 * fine (returns `[]`); malformed entries throw a descriptive error.
 */
function normalizeSimulatorDeeplinks(
  raw: unknown,
  repoRoot: string,
): SimulatorDeeplinkConfig[] {
  if (raw == null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw `simulator_deeplinks in ${repoRoot}/.argus.json must be an array.`;
  }

  return raw.map((entry, i) =>
    normalizeSimulatorDeeplinkEntry(
      entry,
      repoRoot,
      `simulator_deeplinks[${i}]`,
    ),
  );
}

function normalizeSimulatorDeeplinkEntry(
  entry: unknown,
  repoRoot: string,
  trail: string,
): SimulatorDeeplinkConfig {
  if (entry == null || typeof entry !== "object") {
    throw `${trail} in ${repoRoot}/.argus.json must be a { label, url } or { label, children } object.`;
  }
  const obj = entry as Record<string, unknown>;
  const label = typeof obj.label === "string" ? obj.label.trim() : "";
  if (!label) {
    throw `${trail}.label in ${repoRoot}/.argus.json must be a non-empty string.`;
  }
  const hasChildren = obj.children !== undefined;
  const hasUrl = obj.url !== undefined;
  if (hasChildren && hasUrl) {
    throw `${trail} in ${repoRoot}/.argus.json must have either "url" (leaf) or "children" (folder), not both.`;
  }
  if (hasChildren) {
    if (!Array.isArray(obj.children)) {
      throw `${trail}.children in ${repoRoot}/.argus.json must be an array.`;
    }
    const children = (obj.children as unknown[]).map((child, j) =>
      normalizeSimulatorDeeplinkEntry(
        child,
        repoRoot,
        `${trail}.children[${j}]`,
      ),
    );

    return { label, children };
  }
  const url = typeof obj.url === "string" ? obj.url.trim() : "";
  if (!url) {
    throw `${trail}.url in ${repoRoot}/.argus.json must be a non-empty string (or use "children" for a folder).`;
  }

  return { label, url };
}

/**
 * Normalise `release_note_patterns`. Each entry is either a bare glob
 * string (no labels, regex-format default) or a structured object
 * `{ glob, format?, labels? }`. Returns `[]` when absent so the session
 * home screen falls back to changesets.
 */
function normalizeReleaseNotePatterns(
  raw: unknown,
  repoRoot: string,
): ReleaseNotePatternConfig[] {
  if (raw == null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw `release_note_patterns in ${repoRoot}/.argus.json must be an array.`;
  }
  const out: ReleaseNotePatternConfig[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, i) => {
    const normalized = normalizeReleaseNotePattern(entry, repoRoot, i);
    if (!normalized || seen.has(normalized.glob)) {
      return;
    }
    seen.add(normalized.glob);
    out.push(normalized);
  });

  return out;
}

function normalizeReleaseNotePattern(
  raw: unknown,
  repoRoot: string,
  i: number,
): ReleaseNotePatternConfig | null {
  if (typeof raw === "string") {
    const glob = raw.trim();

    return glob ? { glob, format: "changesets", labels: [] } : null;
  }
  if (raw == null || typeof raw !== "object") {
    throw `release_note_patterns[${i}] in ${repoRoot}/.argus.json must be a glob string or { glob, format?, labels? } object.`;
  }
  const obj = raw as Record<string, unknown>;
  const glob = typeof obj.glob === "string" ? obj.glob.trim() : "";
  if (!glob) {
    throw `release_note_patterns[${i}].glob in ${repoRoot}/.argus.json must be a non-empty string.`;
  }
  const format = normalizeReleaseNoteFormat(obj.format, repoRoot, i);
  const labels = normalizeReleaseNoteLabels(obj.labels, repoRoot, i);

  return { glob, format, labels };
}

function normalizeReleaseNoteFormat(
  raw: unknown,
  repoRoot: string,
  i: number,
): ReleaseNoteFormat {
  if (raw == null) {
    return "changesets";
  }
  if (
    raw === "regex" ||
    raw === "json" ||
    raw === "yaml" ||
    raw === "xml" ||
    raw === "changesets"
  ) {
    return raw;
  }
  throw `release_note_patterns[${i}].format in ${repoRoot}/.argus.json must be one of "regex", "json", "yaml", "xml", "changesets".`;
}

function normalizeReleaseNoteLabels(
  raw: unknown,
  repoRoot: string,
  i: number,
): ReleaseNoteLabelConfig[] {
  if (raw == null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw `release_note_patterns[${i}].labels in ${repoRoot}/.argus.json must be an array.`;
  }

  return raw.map((entry, j) => {
    if (entry == null || typeof entry !== "object") {
      throw `release_note_patterns[${i}].labels[${j}] in ${repoRoot}/.argus.json must be an object.`;
    }
    const obj = entry as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    const selector =
      typeof obj.selector === "string" ? obj.selector.trim() : "";
    if (!name) {
      throw `release_note_patterns[${i}].labels[${j}].name in ${repoRoot}/.argus.json must be a non-empty string.`;
    }
    if (!selector) {
      throw `release_note_patterns[${i}].labels[${j}].selector in ${repoRoot}/.argus.json must be a non-empty string.`;
    }
    const tone = normalizeReleaseNoteTone(obj.tone, repoRoot, i, j);

    return tone ? { name, selector, tone } : { name, selector };
  });
}

function normalizeReleaseNoteTone(
  raw: unknown,
  repoRoot: string,
  i: number,
  j: number,
): ReleaseNoteLabelTone | null {
  if (raw == null) {
    return null;
  }
  if (
    raw === "accent" ||
    raw === "neutral" ||
    raw === "success" ||
    raw === "warning"
  ) {
    return raw;
  }
  throw `release_note_patterns[${i}].labels[${j}].tone in ${repoRoot}/.argus.json must be one of "accent", "neutral", "success", "warning".`;
}

/**
 * Normalise `min_argus_version` — must be a semver string of `MAJOR.MINOR.PATCH`
 * digits (with an optional leading `v`). Pre-release / build suffixes are
 * rejected to keep the comparator simple. Returns null when absent.
 */
function normalizeMinArgusVersion(
  raw: unknown,
  repoRoot: string,
): string | null {
  if (raw == null || raw === "") {
    return null;
  }
  if (typeof raw !== "string") {
    throw `min_argus_version in ${repoRoot}/.argus.json must be a semver string like "0.10.0".`;
  }
  const trimmed = raw.trim().replace(/^v/i, "");
  if (!/^\d+\.\d+\.\d+$/.test(trimmed)) {
    throw `min_argus_version in ${repoRoot}/.argus.json must be a semver string like "0.10.0" (got "${raw}").`;
  }

  return trimmed;
}

/**
 * Normalise the `mcp_servers` field — must be a `{ [name]: object }` map.
 * Filters out non-object entries; returns null when absent so merge logic
 * can distinguish "unset" from "explicitly empty".
 */
function normalizeMcpServers(
  raw: unknown,
): Record<string, Record<string, unknown>> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = value as Record<string, unknown>;
    }
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Normalise `auto_fetch_minutes` — must be a positive integer when present.
 * Zero, negative values, and non-numbers are treated as "disabled" (null).
 */
function normalizeAutoFetchMinutes(raw: unknown): number | null {
  if (raw == null) {
    return null;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }

  return Math.floor(n);
}

/**
 * Normalise `protected_branches` from `.argus.json`. Accepts a string array
 * of branch names that cannot be merged into directly from the app. Empty /
 * missing / malformed values return `[]` (no protection).
 */
/**
 * Normalise `default_base_branch`. Accepts a non-empty string; anything else
 * (missing, empty, non-string) returns `null`.
 */
function normalizeDefaultBaseBranch(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function normalizeProtectedBranches(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (trimmed && !out.includes(trimmed)) {
        out.push(trimmed);
      }
    }
  }

  return out;
}

/**
 * Normalise a `setup.copy` / `setup.symlink` array. Each entry may be a bare
 * string (path or glob) or `{ path, exclude? }`. Returns `[]` when absent;
 * throws on malformed entries (so typos in `path`/`exclude` surface at
 * parse time instead of being silently dropped).
 */
function normalizeSetupEntries(
  raw: unknown,
  repoRoot: string,
  field: string,
): SetupCopyEntry[] {
  if (raw == null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw `${field} in ${repoRoot}/.argus.json must be an array of strings or { path, exclude? } objects.`;
  }

  return raw.map((entry, i) => {
    if (typeof entry === "string") {
      return entry;
    }
    if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
      throw `${field}[${i}] in ${repoRoot}/.argus.json must be a string or { path, exclude? } object.`;
    }
    const obj = entry as Record<string, unknown>;
    if (typeof obj.path !== "string" || !obj.path.trim()) {
      throw `${field}[${i}].path in ${repoRoot}/.argus.json must be a non-empty string.`;
    }
    const entryPath = obj.path;
    if (obj.exclude == null) {
      return { path: entryPath };
    }
    if (!Array.isArray(obj.exclude)) {
      throw `${field}[${i}].exclude in ${repoRoot}/.argus.json must be an array of glob strings.`;
    }
    const exclude: string[] = [];
    for (const e of obj.exclude) {
      if (typeof e !== "string" || !e.trim()) {
        throw `${field}[${i}].exclude in ${repoRoot}/.argus.json must contain non-empty strings.`;
      }
      exclude.push(e);
    }

    return exclude.length > 0
      ? { path: entryPath, exclude }
      : { path: entryPath };
  });
}

/**
 * Normalise the `run` field. Must be an array of objects shaped like
 * `RunCommand`. Throws a descriptive error for the legacy string / single
 * object forms so users migrate explicitly.
 */
function normalizeRunCommands(raw: unknown, repoRoot: string): RunCommand[] {
  if (raw == null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw (
      `\`run\` in .argus.json at ${repoRoot} must be an array of ` +
      `{ title, command, cwd?, restartOnRerun } objects. ` +
      `The old single-string / single-object form is no longer supported.`
    );
  }

  return raw.map((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      throw `run[${i}] in ${repoRoot}/.argus.json must be an object.`;
    }
    const obj = entry as Record<string, unknown>;
    const title = obj.title;
    const command = obj.command;
    if (typeof title !== "string" || !title) {
      throw `run[${i}].title in ${repoRoot}/.argus.json must be a non-empty string.`;
    }
    if (typeof command !== "string" || !command) {
      throw `run[${i}].command in ${repoRoot}/.argus.json must be a non-empty string.`;
    }

    const requires: string[] = [];
    if (Array.isArray(obj.requires)) {
      for (const r of obj.requires) {
        if (typeof r !== "string" || !r.trim()) {
          throw `run[${i}].requires in ${repoRoot}/.argus.json must be an array of non-empty title strings.`;
        }
        const trimmed = r.trim();
        if (trimmed === title) {
          throw `run[${i}].requires in ${repoRoot}/.argus.json cannot reference its own title '${title}'.`;
        }
        if (!requires.includes(trimmed)) {
          requires.push(trimmed);
        }
      }
    } else if (obj.requires != null) {
      throw `run[${i}].requires in ${repoRoot}/.argus.json must be an array of run-command titles.`;
    }

    return {
      title,
      command,
      cwd: typeof obj.cwd === "string" && obj.cwd ? obj.cwd : undefined,
      restartOnRerun: Boolean(obj.restartOnRerun),
      ...(requires.length > 0 ? { requires } : {}),
    };
  });
}

/**
 * Normalise `platforms` from `.argus.json`. Accepts an array of the
 * strings "ios" | "android" | "tvos" | "web" (case-insensitive); returns
 * null if absent or unparseable so the prompt falls back to describing
 * the default set.
 */
function normalizePlatforms(raw: unknown): ArgusConfig["platforms"] {
  if (!Array.isArray(raw)) {
    return null;
  }
  const valid: ("android" | "ios" | "tvos" | "web")[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") {
      continue;
    }
    const lower = entry.toLowerCase();
    if (
      lower === "ios" ||
      lower === "android" ||
      lower === "tvos" ||
      lower === "web"
    ) {
      if (!valid.includes(lower)) {
        valid.push(lower);
      }
    }
  }

  return valid.length > 0 ? valid : null;
}

/**
 * Normalise `related_projects` from its possible JSON forms into an array.
 * Accepts: null/undefined or an array of { path, description } objects.
 */
function normalizeRelatedProjects(raw: unknown): RelatedProject[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter(
      (entry): entry is RelatedProject =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as Record<string, unknown>).path === "string",
    )
    .map((entry) => ({
      path: entry.path,
      description: entry.description ?? "",
    }));
}

/**
 * Normalise `browser_presets` from its possible JSON forms into an array.
 * Accepts: null/undefined or an array of { id, width, height, ... } objects.
 * Filters out entries with missing/invalid id, width, or height.
 */
function normalizeBrowserPresets(raw: unknown): BrowserPresetConfig[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((entry): entry is BrowserPresetConfig => {
      if (typeof entry !== "object" || entry === null) {
        return false;
      }
      const obj = entry as Record<string, unknown>;

      return (
        typeof obj.id === "string" &&
        obj.id.length > 0 &&
        typeof obj.width === "number" &&
        obj.width > 0 &&
        typeof obj.height === "number" &&
        obj.height > 0
      );
    })
    .map((entry) => ({
      id: entry.id,
      width: entry.width,
      height: entry.height,
      ...(entry.label ? { label: entry.label } : {}),
      ...(entry.user_agent ? { user_agent: entry.user_agent } : {}),
    }));
}

/**
 * Merge a local config on top of a base config.
 *
 * - `setup.copy`, `setup.symlink`, `setup.commands` — concatenated (deduped).
 * - `terminals` — concatenated.
 * - `workspace_env` — local replaces base if present.
 * - `run` — local replaces base if present.
 */
function mergeConfig(base: ArgusConfig, local: ArgusConfig): ArgusConfig {
  function dedupExtend(target: string[], source: string[]): string[] {
    const result = [...target];
    for (const item of source) {
      if (!result.includes(item)) {
        result.push(item);
      }
    }

    return result;
  }

  // Setup entries dedupe by path (so a `.argus.local.json` override that adds
  // an `exclude` to an entry from the base config replaces the base entry
  // instead of producing two copies of the same path).
  function dedupExtendSetup(
    target: SetupCopyEntry[],
    source: SetupCopyEntry[],
  ): SetupCopyEntry[] {
    const sourcePaths = new Set(source.map(setupEntryPath));
    const result = target.filter((e) => !sourcePaths.has(setupEntryPath(e)));

    return [...result, ...source];
  }

  return {
    setup: {
      copy: dedupExtendSetup(base.setup.copy, local.setup.copy),
      symlink: dedupExtendSetup(base.setup.symlink, local.setup.symlink),
      commands: dedupExtend(base.setup.commands, local.setup.commands),
    },
    terminals: [...base.terminals, ...local.terminals],
    workspace_env:
      local.workspace_env.length > 0 ? local.workspace_env : base.workspace_env,
    run: local.run.length > 0 ? local.run : base.run,
    agent_prompt: local.agent_prompt ?? base.agent_prompt,
    related_projects: dedupRelatedProjects(
      base.related_projects ?? [],
      local.related_projects ?? [],
    ),
    browser_url: local.browser_url ?? base.browser_url,
    browser_presets: dedupBrowserPresets(
      base.browser_presets,
      local.browser_presets,
    ),
    save_chat_history: local.save_chat_history ?? base.save_chat_history,
    platforms: local.platforms ?? base.platforms ?? null,
    protected_branches:
      local.protected_branches.length > 0
        ? local.protected_branches
        : base.protected_branches,
    default_base_branch:
      local.default_base_branch ?? base.default_base_branch ?? null,
    single_runtime: local.single_runtime ?? base.single_runtime ?? false,
    mcp_servers:
      local.mcp_servers || base.mcp_servers
        ? { ...(base.mcp_servers ?? {}), ...(local.mcp_servers ?? {}) }
        : null,
    min_argus_version:
      local.min_argus_version ?? base.min_argus_version ?? null,
    release_note_patterns: dedupReleaseNotePatterns(
      base.release_note_patterns,
      local.release_note_patterns,
    ),
    simulator_deeplinks:
      local.simulator_deeplinks.length > 0
        ? local.simulator_deeplinks
        : base.simulator_deeplinks,
    auto_fetch_minutes:
      local.auto_fetch_minutes ?? base.auto_fetch_minutes ?? null,
    llm: mergeLlmConfig(base.llm ?? null, local.llm ?? null),
    tools: local.tools ?? base.tools ?? null,
  };
}

/** Per-field override: local wins on `runner`/`model` if set. */
function mergeLlmConfig(
  base: LlmConfig | null,
  local: LlmConfig | null,
): LlmConfig | null {
  if (!base && !local) {
    return null;
  }
  const runner = local?.runner ?? base?.runner ?? null;
  const model = local?.model ?? base?.model ?? null;
  if (runner == null && model == null) {
    return null;
  }

  return {
    ...(runner != null ? { runner } : {}),
    ...(model != null ? { model } : {}),
  };
}

/** Merge release-note pattern lists, deduplicating by glob (local wins on collision). */
function dedupReleaseNotePatterns(
  base: ReleaseNotePatternConfig[],
  local: ReleaseNotePatternConfig[],
): ReleaseNotePatternConfig[] {
  const localGlobs = new Set(local.map((p) => p.glob));
  const result = base.filter((p) => !localGlobs.has(p.glob));

  return [...result, ...local];
}

/**
 * Return true when `branch` is listed as a protected branch in the project's
 * `.argus.json`. Used to gate the direct merge flow.
 */
export function isBranchProtected(
  repoRoot: string,
  branch: string | null | undefined,
): boolean {
  if (!branch) {
    return false;
  }
  try {
    const config = loadArgusConfig(repoRoot);

    return config.protected_branches.includes(branch);
  } catch {
    return false;
  }
}

/** Merge related project lists, deduplicating by path. */
function dedupRelatedProjects(
  base: RelatedProject[],
  local: RelatedProject[],
): RelatedProject[] {
  const seen = new Set(base.map((p) => p.path));
  const result = [...base];
  for (const p of local) {
    if (!seen.has(p.path)) {
      seen.add(p.path);
      result.push(p);
    }
  }

  return result;
}

/** Merge browser preset lists, deduplicating by id (local wins on collision). */
function dedupBrowserPresets(
  base: BrowserPresetConfig[],
  local: BrowserPresetConfig[],
): BrowserPresetConfig[] {
  const localIds = new Set(local.map((p) => p.id));
  const result = base.filter((p) => !localIds.has(p.id));

  return [...result, ...local];
}

// ---------------------------------------------------------------------------
// Glob / path helpers
// ---------------------------------------------------------------------------

/** Returns true if the string contains glob metacharacters. */
function isGlobPattern(s: string): boolean {
  return s.includes("*") || s.includes("?") || s.includes("[");
}

/**
 * Filter out paths that are nested inside another path in the list.
 * E.g. for `**\/node_modules`, we get both `apps/foo/node_modules` and
 * `apps/foo/node_modules/pkg/node_modules`. Copying/symlinking the parent
 * already includes nested content; including nested paths is redundant.
 */
function filterNestedPaths(paths: string[]): string[] {
  return paths.filter(
    (p) => !paths.some((other) => other !== p && p.startsWith(other + "/")),
  );
}

/**
 * Expand a copy/symlink entry into relative paths (relative to repoRoot).
 * If the entry is a glob pattern, returns all matching paths.
 * Otherwise returns the single entry if it exists on disk.
 *
 * `excludes` are forwarded to fast-glob's `ignore` for glob entries (so
 * matched paths inside excluded directories are pruned during expansion)
 * and matched against literal paths so an excluded directory entry never
 * surfaces as a top-level match either.
 */
async function expandPatterns(
  repoRoot: string,
  rel: string,
  excludes: string[] = [],
): Promise<string[]> {
  if (!isGlobPattern(rel)) {
    const full = path.join(repoRoot, rel);
    if (fs.existsSync(full) && !rel.split("/").includes(".git")) {
      return [rel];
    }

    return [];
  }

  // Use fast-glob to expand the pattern, rooted at repoRoot.
  const matches = await fg(rel, {
    cwd: repoRoot,
    dot: true,
    onlyFiles: false,
    ignore: ["**/.git/**", ".git", ...excludes],
  });

  return matches.filter((m) => !m.split("/").includes(".git")).sort();
}

// ---------------------------------------------------------------------------
// Setup pipeline
// ---------------------------------------------------------------------------

/**
 * Execute the setup pipeline for a newly created worktree.
 *
 * A real PTY is spawned and registered as a "Setup" tab on the session so the
 * user can see init output live and respond to interactive prompts instead of
 * having the pipeline silently hang. The copy/symlink phases run in Node.js
 * and emit log lines directly to the terminal's output channel; the commands
 * phase writes each command into the PTY's stdin and waits for a sentinel
 * carrying the exit code.
 *
 * Progress is also reported via `session:setup_progress:{sessionId}` events
 * for the header progress bar.
 *
 * Returns on success; throws a string describing the first step that failed.
 * On both success and failure the PTY is left alive so the user can inspect
 * state or continue working in the shell.
 */
export async function runSetupPipeline(
  repoRoot: string,
  worktreePath: string,
  config: ArgusConfig,
  sessionId: string,
  preCreatedTerminalId?: string | null,
): Promise<void> {
  info(
    `Setup pipeline started for session ${sessionId}, repo_root=${repoRoot}, worktree=${worktreePath}`,
  );

  // Use the caller-supplied PTY if one was pre-spawned (so its id could be
  // returned in the create_session response without a race), otherwise spawn
  // one here. createTerminal registers it in appState.terminals and wires up
  // the standard terminal:data / terminal:exit channels.
  let terminalId = preCreatedTerminalId ?? null;
  if (!terminalId || !appState.terminals.has(terminalId)) {
    terminalId = createTerminal(sessionId, undefined, setupShellCommand());
  }
  const terminal = appState.terminals.get(terminalId);
  if (!terminal) {
    throw `Failed to create setup terminal for session ${sessionId}`;
  }
  const setupPty = terminal.pty;

  // Fire the setup-terminal event so listeners registered via the realtime
  // path (not via the synchronous create_session response) still attach a tab.
  getMainWindow()?.webContents.send(`session:setup_terminal:${sessionId}`, {
    terminalId,
    title: "Setup",
  });

  const progressEvent = `session:setup_progress:${sessionId}`;

  // Write decorated log lines directly to the terminal's output channel.
  // This bypasses the shell's stdin so our banners don't get echoed back by
  // the line editor and don't interfere with any command in flight.
  const emit = (msg: string) => {
    const encoded = Buffer.from(msg).toString("base64");
    getMainWindow()?.webContents.send(`terminal:data:${terminalId}`, encoded);
  };

  const emitProgressItem = (
    item: string,
    current: number,
    total: number,
    phase: "command" | "copy" | "matching" | "symlink",
  ) => {
    getMainWindow()?.webContents.send(progressEvent, {
      item,
      current,
      total,
      phase,
    });
  };

  // Run a single setup command inside the PTY and resolve with its exit code.
  // We append a printf that emits a unique sentinel containing `$?`, then
  // scan the PTY output stream for it. The sentinel matches POSIX sh / bash /
  // zsh; fish (and other non-POSIX shells) as $SHELL will hang — acceptable
  // limitation for v1 since setup typically runs via sh-style shells.
  const runInPty = (cmd: string): Promise<number> =>
    new Promise((resolve, reject) => {
      const token = crypto.randomUUID().replace(/-/g, "");
      const sentinel = `__ARGUS_DONE_${token}__`;
      const re = new RegExp(`${sentinel}:(\\d+)`);
      let buffer = "";
      let settled = false;
      let lastOutputAt = Date.now();
      const finish = () => {
        settled = true;
        dataDisposable.dispose();
        exitDisposable.dispose();
        clearInterval(idleTimer);
      };
      const dataDisposable = setupPty.onData((data: string) => {
        if (settled) {
          return;
        }
        lastOutputAt = Date.now();
        // Strip escape sequences before matching: prompt redraws and progress
        // spinners can interleave cursor moves with the sentinel line.
        buffer += stripAnsi(data);
        const match = buffer.match(re);
        if (match) {
          finish();
          resolve(parseInt(match[1], 10));

          return;
        }
        if (buffer.length > 64 * 1024) {
          buffer = buffer.slice(-32 * 1024);
        }
      });
      // If the PTY dies before we see the sentinel (terminal closed, shell
      // crashed, command received SIGKILL), reject so the setup pipeline
      // unblocks instead of hanging forever in "initializing".
      const exitDisposable = setupPty.onExit(({ exitCode, signal }) => {
        if (settled) {
          return;
        }
        finish();
        reject(
          `Setup PTY exited before command completed (exitCode=${exitCode}${
            signal ? `, signal=${signal}` : ""
          }) while running: ${cmd}`,
        );
      });
      // A swallowed sentinel used to leave the session stuck in "initializing"
      // forever. Fail loudly after a long silence instead.
      const idleTimer = setInterval(() => {
        if (settled || Date.now() - lastOutputAt < SETUP_IDLE_TIMEOUT_MS) {
          return;
        }
        finish();
        reject(
          `Setup command produced no output for ${Math.round(
            SETUP_IDLE_TIMEOUT_MS / 60000,
          )} minutes and never reported an exit code: ${cmd}`,
        );
      }, 30_000);
      // Chain the sentinel printf with `;` so it runs regardless of cmd's
      // exit status and reports it via `$?`. Newline terminates the input
      // line so the shell actually executes.
      setupPty.write(`${cmd}; printf '\\n${sentinel}:%s\\n' "$?"\n`);
    });

  // Hand control of the PTY back to the user once setup is done (or has
  // failed). Unlocks renderer input and execs into the user's real shell so
  // the tab becomes a normal interactive terminal cwd'd in the worktree.
  const handoffToUserShell = () => {
    const userShell = process.env.SHELL ?? "/bin/sh";
    // Clear the current input line (in case anything queued while locked) and
    // exec the login shell so it replaces the setup shell in-place. `PS1` is
    // dropped so the setup shell's blank prompt doesn't leak into it.
    setupPty.write(`unset PS1; exec ${userShell} -l\n`);
    const t = appState.terminals.get(terminalId);
    if (t) {
      t.locked = false;
    }
  };

  try {
    await runSetupBody();
  } catch (e) {
    handoffToUserShell();
    throw e;
  }
  handoffToUserShell();

  return;

  // ------------------------------------------------------------------
  async function runSetupBody(): Promise<void> {
    // Pre-compute all items to get total count for progress bar.
    const allItems: string[] = [];

    info("Setup pipeline: expanding copy patterns");
    for (const entry of config.setup.copy) {
      const rel = setupEntryPath(entry);
      const excludes = setupEntryExcludes(entry);
      emitProgressItem(`Matching: ${rel}`, 0, 0, "matching");
      emit(`[argus] Matching pattern ${rel}...\r\n`);
      const expanded = filterNestedPaths(
        await expandPatterns(repoRoot, rel, excludes),
      );
      if (expanded.length === 0) {
        emit(`[argus] Warning: ${rel} matched nothing, skipping.\r\n`);
      } else {
        allItems.push(...expanded);
      }
    }

    info("Setup pipeline: expanding symlink patterns");
    for (const entry of config.setup.symlink) {
      const rel = setupEntryPath(entry);
      const excludes = setupEntryExcludes(entry);
      emitProgressItem(`Matching: ${rel}`, 0, 0, "matching");
      emit(`[argus] Matching pattern ${rel}...\r\n`);
      const expanded = filterNestedPaths(
        await expandPatterns(repoRoot, rel, excludes),
      );
      if (expanded.length === 0) {
        emit(`[argus] Warning: ${rel} matched nothing, skipping.\r\n`);
      } else {
        allItems.push(...expanded);
      }
    }

    for (const cmd of config.setup.commands) {
      allItems.push(cmd);
    }

    const total = allItems.length;
    info(
      `Setup pipeline: ${total} items total (${config.setup.copy.length} copy, ${config.setup.symlink.length} symlink, ${config.setup.commands.length} commands)`,
    );

    let idx = 0;

    // -- Copy phase ------------------------------------------------------------
    info("Setup pipeline: starting copy phase");
    for (const entry of config.setup.copy) {
      const rel = setupEntryPath(entry);
      const excludes = setupEntryExcludes(entry);
      const expanded = filterNestedPaths(
        await expandPatterns(repoRoot, rel, excludes),
      );
      if (expanded.length === 0) {
        continue;
      }

      for (const relPath of expanded) {
        const src = path.join(repoRoot, relPath);
        const dst = path.join(worktreePath, relPath);
        idx += 1;
        info(`Setup pipeline: copying [${idx}/${total}] ${relPath}`);
        emitProgressItem(relPath, idx, total, "copy");
        emit(`[argus] Copying ${relPath}...\r\n`);

        try {
          const stat = await fs.promises.stat(src);
          if (stat.isDirectory()) {
            await copyDirAll(src, dst, excludes);
          } else if (stat.isFile()) {
            await fs.promises.mkdir(path.dirname(dst), { recursive: true });
            await fs.promises.copyFile(src, dst);
          } else {
            emit(`[argus] Warning: ${relPath} not found, skipping.\r\n`);
          }
        } catch (e) {
          throw `Failed to copy '${relPath}': ${e}`;
        }
      }
    }

    // -- Symlink phase ---------------------------------------------------------
    info("Setup pipeline: starting symlink phase");
    for (const entry of config.setup.symlink) {
      const rel = setupEntryPath(entry);
      const excludes = setupEntryExcludes(entry);
      const expanded = filterNestedPaths(
        await expandPatterns(repoRoot, rel, excludes),
      );
      if (expanded.length === 0) {
        emit(`[argus] Warning: ${rel} matched nothing, skipping.\r\n`);
        continue;
      }

      for (const relPath of expanded) {
        const src = path.join(repoRoot, relPath);
        const dst = path.join(worktreePath, relPath);
        idx += 1;
        info(`Setup pipeline: symlinking [${idx}/${total}] ${relPath}`);
        emitProgressItem(relPath, idx, total, "symlink");
        emit(`[argus] Symlinking ${relPath}...\r\n`);

        fs.mkdirSync(path.dirname(dst), { recursive: true });

        // Remove existing destination so we can re-create the symlink.
        if (fs.existsSync(dst) || isSymlink(dst)) {
          try {
            const dstStat = fs.lstatSync(dst);
            if (dstStat.isDirectory() && !dstStat.isSymbolicLink()) {
              fs.rmSync(dst, { recursive: true, force: true });
            } else {
              fs.unlinkSync(dst);
            }
          } catch (e) {
            throw `Failed to remove existing '${relPath}': ${e}`;
          }
        }

        try {
          fs.symlinkSync(src, dst);
        } catch (e) {
          throw `Failed to symlink '${relPath}': ${e}`;
        }
      }
    }

    // -- Commands phase --------------------------------------------------------
    // Drive each command through the setup PTY. Output streams naturally via
    // the terminal's data channel, so nothing to re-emit here. If a command
    // prompts for input, the user can type into the visible tab and unblock it.
    info("Setup pipeline: starting commands phase");
    for (const cmdStr of config.setup.commands) {
      idx += 1;
      info(`Setup pipeline: running command [${idx}/${total}] ${cmdStr}`);
      emitProgressItem(cmdStr, idx, total, "command");
      emit(`\r\n[argus] Running: ${cmdStr}\r\n`);

      const exitCode = await runInPty(cmdStr);

      if (exitCode !== 0) {
        emit(`[argus] Command failed (exit ${exitCode}): ${cmdStr}\r\n`);
        throw `Setup command failed: ${cmdStr}`;
      }

      info(`Setup pipeline: command completed: ${cmdStr}`);
    }

    info(`Setup pipeline: complete for session ${sessionId}`);
    emit("\r\n[argus] Setup complete.\r\n");
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively copy a directory tree from `src` to `dst`.
 *
 * Uses the system `cp` binary rather than `fs.promises.cp` because Electron
 * patches `fs` to treat `.asar` archives as directories, which makes `fs.cp`
 * fail with "Invalid package" on trees containing asar files (e.g.
 * node_modules/electron/dist/.../default_app.asar). The `process.noAsar`
 * toggle isn't safe here: it's a global, and parallel setup pipelines (e.g.
 * `spawn_agents_batch`) race on its value — one pipeline's `finally` block
 * can reset the flag while another is still copying. Shelling out sidesteps
 * the asar layer entirely.
 *
 * We use rsync with `-a` (which includes `-l`, preserving symlinks as
 * symlinks). Every symlink — including pnpm's `.pnpm/` internal forest and
 * workspace package links like `node_modules/@argus/peacock → ../../packages/
 * peacock` — is copied verbatim. The worktree has its own `packages/`
 * checkout at the same relative path, so workspace-symlink targets still
 * resolve correctly.
 *
 * Do NOT add `--copy-unsafe-links`: it dereferences any symlink pointing
 * outside the source (e.g. workspace packages, since they live next to
 * `node_modules/`, not inside it) into a frozen snapshot — edits to the
 * workspace source never reach the worktree.
 */
async function copyDirAll(
  src: string,
  dst: string,
  excludes: string[] = [],
): Promise<void> {
  await fs.promises.mkdir(path.dirname(dst), { recursive: true });
  // If dst exists, remove it first so the copy overwrites cleanly rather than
  // landing src *inside* dst.
  if (fs.existsSync(dst)) {
    await fs.promises.rm(dst, { recursive: true, force: true });
  }
  // Trailing slash on src tells rsync to copy the contents of src into dst
  // (matching `cp -R src dst` semantics where dst doesn't yet exist).
  // `--exclude=<pattern>` prunes during traversal — unlike fast-glob's
  // post-expansion `ignore`, this stops rsync from descending into
  // directories like `.claude/projects/.../worktrees` that the user
  // explicitly opted out of.
  const args = ["-a", ...excludes.map((p) => `--exclude=${p}`), `${src}/`, dst];
  await execFileAsync("rsync", args);
}

/** Returns true if `p` is a symlink (without throwing on missing path). */
function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
