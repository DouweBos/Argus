/**
 * Loading `.argus.json`: read, parse, merge `.argus.local.json` on top.
 *
 * Split out of `setup.ts` — the setup pipeline needs a terminal and the
 * terminal needs the config, so keeping both in one file was a cycle. The
 * per-field normalizers live in `argusConfigNormalize.ts`.
 */

import fs from "node:fs";
import path from "node:path";
import {
  normalizeAutoFetchMinutes,
  normalizeBrowserPresets,
  normalizeDefaultBaseBranch,
  normalizeLlmConfig,
  normalizeMcpServers,
  normalizeMinArgusVersion,
  normalizeProjectAutomations,
  normalizeProtectedBranches,
  normalizeRelatedProjects,
  normalizeReleaseNotePatterns,
  normalizeRunCommands,
  normalizeSetupEntries,
  normalizeSimulatorDeeplinks,
  normalizeToolsConfig,
  normalizeWorkspaceEnv,
} from "./argusConfigNormalize";
import {
  type BrowserPresetConfig,
  defaultArgusConfig,
  type LlmConfig,
  type RelatedProject,
  type ReleaseNotePatternConfig,
  type SetupConfig,
  type SetupCopyEntry,
  type ArgusConfig,
  setupEntryPath,
} from "./models";

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
    protected_branches: normalizeProtectedBranches(parsed.protected_branches),
    default_base_branch: normalizeDefaultBaseBranch(parsed.default_base_branch),
    single_runtime:
      parsed.single_runtime != null ? Boolean(parsed.single_runtime) : false,
    auto_continue_on_limit:
      parsed.auto_continue_on_limit != null
        ? Boolean(parsed.auto_continue_on_limit)
        : null,
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
    automations: normalizeProjectAutomations(parsed.automations),
  };
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
    protected_branches:
      local.protected_branches.length > 0
        ? local.protected_branches
        : base.protected_branches,
    default_base_branch:
      local.default_base_branch ?? base.default_base_branch ?? null,
    single_runtime: local.single_runtime ?? base.single_runtime ?? false,
    auto_continue_on_limit:
      local.auto_continue_on_limit ?? base.auto_continue_on_limit ?? false,
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
    automations: local.automations ?? base.automations ?? null,
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
