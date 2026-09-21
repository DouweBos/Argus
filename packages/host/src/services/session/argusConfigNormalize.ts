/**
 * Turning whatever `.argus.json` actually contains into a valid config.
 *
 * Every function here is total: hostile, partial or plain wrong input yields a
 * sane value, never a throw. Kept apart from `argusConfig.ts` so the loading
 * and merging logic stays readable next to ~20 field normalizers.
 */

import type {
  BrowserPresetConfig,
  LlmConfig,
  ProjectAutomationConfig,
  RelatedProject,
  ReleaseNoteFormat,
  ReleaseNoteLabelConfig,
  ReleaseNoteLabelTone,
  ReleaseNotePatternConfig,
  RunCommand,
  SetupCopyEntry,
  SimulatorDeeplinkConfig,
  ArgusConfig,
  WorkspaceEnvConfig,
} from "./models";
import { warn } from "@argus/host/logger";
import { isAutonomyLevel } from "../automation/guardrails";

export function normalizeWorkspaceEnv(raw: unknown): WorkspaceEnvConfig[] {
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

export function normalizeProjectAutomations(
  input: unknown,
): ProjectAutomationConfig | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const raw = input as Record<string, unknown>;
  const ceiling = isAutonomyLevel(raw.autonomy_ceiling)
    ? raw.autonomy_ceiling
    : null;
  const disabled = stringList(raw.disabled);
  const denylist = stringList(raw.path_denylist);
  if (!ceiling && disabled.length === 0 && denylist.length === 0) {
    return null;
  }

  return {
    ...(ceiling ? { autonomy_ceiling: ceiling } : {}),
    ...(disabled.length > 0 ? { disabled } : {}),
    ...(denylist.length > 0 ? { path_denylist: denylist } : {}),
  };
}

export function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
}

/**
 * Normalise the optional `tools.disabled` list. Anything that isn't a
 * non-empty string is dropped; we don't validate against the registry here
 * because the renderer is what consumes this and unknown ids are harmless.
 */
export function normalizeToolsConfig(
  input: unknown,
): { disabled?: string[] } | null {
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
export function normalizeLlmConfig(
  raw: unknown,
  repoRoot: string,
): LlmConfig | null {
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
export function normalizeSimulatorDeeplinks(
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

export function normalizeSimulatorDeeplinkEntry(
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
export function normalizeReleaseNotePatterns(
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

export function normalizeReleaseNotePattern(
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

export function normalizeReleaseNoteFormat(
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

export function normalizeReleaseNoteLabels(
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

export function normalizeReleaseNoteTone(
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
export function normalizeMinArgusVersion(
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
export function normalizeMcpServers(
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
export function normalizeAutoFetchMinutes(raw: unknown): number | null {
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
export function normalizeDefaultBaseBranch(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();

  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeProtectedBranches(raw: unknown): string[] {
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
export function normalizeSetupEntries(
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
export function normalizeRunCommands(
  raw: unknown,
  repoRoot: string,
): RunCommand[] {
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
export function normalizePlatforms(raw: unknown): ArgusConfig["platforms"] {
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
export function normalizeRelatedProjects(raw: unknown): RelatedProject[] {
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
export function normalizeBrowserPresets(raw: unknown): BrowserPresetConfig[] {
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
