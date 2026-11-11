/**
 * Parsing a `.argus.json`-format object into a config and merging one layer
 * over another. The per-field normalizers live in `argusConfigNormalize.ts`.
 */

import {
  normalizeAutoFetchMinutes,
  normalizeBrowserPresets,
  normalizeDefaultBaseBranch,
  normalizeLlmConfig,
  normalizeProjectAutomations,
  normalizeProtectedBranches,
  normalizeRelatedProjects,
  normalizeReleaseNotePatterns,
  normalizeRunCommands,
  normalizeSetupEntries,
  normalizeSimulatorDeeplinks,
  normalizeToolsConfig,
  normalizeVerifyConfig,
  normalizeWorkspaceEnv,
} from "./argusConfigNormalize";
import {
  type BrowserPresetConfig,
  type LlmConfig,
  type RelatedProject,
  type ReleaseNotePatternConfig,
  type SetupConfig,
  type SetupCopyEntry,
  type ArgusConfig,
  type TerminalConfig,
  setupEntryPath,
} from "./models";

/** Defaults go on after the merge, so a layer that omits a key doesn't override the team's value. */
export function applyDefaults(config: ArgusConfig): ArgusConfig {
  return {
    ...config,
    single_runtime: config.single_runtime ?? false,
    auto_continue_on_limit: config.auto_continue_on_limit ?? false,
  };
}

/**
 * Parse raw JSON into a `ArgusConfig`. The `run` field must be an array of
 * `RunCommand` objects — the old string / single-object form is rejected.
 */
export function parseArgusConfig(
  parsed: Record<string, unknown>,
  repoRoot: string,
): ArgusConfig {
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
    related_projects: normalizeRelatedProjects(parsed.related_projects),
    browser_url: (parsed.browser_url as string) ?? null,
    browser_presets: normalizeBrowserPresets(parsed.browser_presets),
    protected_branches: normalizeProtectedBranches(parsed.protected_branches),
    default_base_branch: normalizeDefaultBaseBranch(parsed.default_base_branch),
    single_runtime:
      parsed.single_runtime != null ? Boolean(parsed.single_runtime) : null,
    auto_continue_on_limit:
      parsed.auto_continue_on_limit != null
        ? Boolean(parsed.auto_continue_on_limit)
        : null,
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
    automations: normalizeProjectAutomations(parsed.automations),
    verify: normalizeVerifyConfig(parsed.verify),
  };
}

/**
 * Merge a layer (the host-stored config) on top of a base config (the repo's).
 *
 * - `setup.copy`, `setup.symlink`, `setup.commands` — concatenated (deduped).
 * - `terminals` — concatenated.
 * - `workspace_env` — local replaces base if present.
 * - `run` — local replaces base if present.
 */
export function mergeConfig(
  base: ArgusConfig,
  local: ArgusConfig,
): ArgusConfig {
  function dedupExtend(target: string[], source: string[]): string[] {
    const result = [...target];
    for (const item of source) {
      if (!result.includes(item)) {
        result.push(item);
      }
    }

    return result;
  }

  // Setup entries dedupe by path (so a layer that adds
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
    terminals: dedupTerminals(base.terminals, local.terminals),
    workspace_env:
      local.workspace_env.length > 0 ? local.workspace_env : base.workspace_env,
    run: local.run.length > 0 ? local.run : base.run,
    related_projects: dedupRelatedProjects(
      base.related_projects ?? [],
      local.related_projects ?? [],
    ),
    browser_url: local.browser_url ?? base.browser_url,
    browser_presets: dedupBrowserPresets(
      base.browser_presets,
      local.browser_presets,
    ),
    protected_branches:
      local.protected_branches.length > 0
        ? local.protected_branches
        : base.protected_branches,
    default_base_branch:
      local.default_base_branch ?? base.default_base_branch ?? null,
    single_runtime: local.single_runtime ?? base.single_runtime,
    auto_continue_on_limit:
      local.auto_continue_on_limit ?? base.auto_continue_on_limit,
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
    automations: local.automations ?? base.automations ?? null,
    verify: local.verify ?? base.verify ?? null,
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

/** Concatenate terminal lists, skipping exact repeats of a base entry. */
function dedupTerminals(
  base: TerminalConfig[],
  local: TerminalConfig[],
): TerminalConfig[] {
  const key = (t: TerminalConfig) => `${t.name}\u0000${t.dir}`;
  const seen = new Set(base.map(key));

  return [...base, ...local.filter((t) => !seen.has(key(t)))];
}
