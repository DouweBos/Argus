/**
 * `.argus.json` config loading, merging, and the worktree setup pipeline
 * (copy, symlink, commands).
 */

import fg from "fast-glob";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { info } from "../../../app/lib/logger";
import { getMainWindow } from "../../main";
import {
  type BrowserPresetConfig,
  defaultArgusConfig,
  type RelatedProject,
  type SetupConfig,
  type ArgusConfig,
  type WorkspaceEnvConfig,
} from "./models";

const execFileAsync = promisify(execFile);

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
      config = parseArgusConfig(raw);
    } catch (e) {
      throw `Failed to read/parse .argus.json: ${e}`;
    }
  }

  const localPath = path.join(repoRoot, ".argus.local.json");
  if (fs.existsSync(localPath)) {
    try {
      const raw = fs.readFileSync(localPath, "utf8");
      const local = parseArgusConfig(raw);
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
 * Parse raw JSON into a `ArgusConfig`. Handles the `run` field's dual
 * string/object form.
 */
function parseArgusConfig(raw: string): ArgusConfig {
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const setup = (parsed.setup as Partial<SetupConfig>) ?? {};
  const runRaw = parsed.run ?? parsed.workspace_port_env;

  let run: ArgusConfig["run"];
  if (runRaw == null) {
    run = null;
  } else if (typeof runRaw === "string") {
    run = { command: runRaw };
  } else {
    run = runRaw as ArgusConfig["run"];
  }

  return {
    setup: {
      copy: (setup.copy as string[]) ?? [],
      symlink: (setup.symlink as string[]) ?? [],
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
  };
}

/**
 * Normalise `platforms` from `.argus.json`. Accepts an array of the
 * strings "ios" | "android" | "web" (case-insensitive); returns null if
 * absent or unparseable so the prompt falls back to describing all three.
 */
function normalizePlatforms(raw: unknown): ArgusConfig["platforms"] {
  if (!Array.isArray(raw)) {
    return null;
  }
  const valid: ("android" | "ios" | "web")[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") {
      continue;
    }
    const lower = entry.toLowerCase();
    if (lower === "ios" || lower === "android" || lower === "web") {
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

  return {
    setup: {
      copy: dedupExtend(base.setup.copy, local.setup.copy),
      symlink: dedupExtend(base.setup.symlink, local.setup.symlink),
      commands: dedupExtend(base.setup.commands, local.setup.commands),
    },
    terminals: [...base.terminals, ...local.terminals],
    workspace_env:
      local.workspace_env.length > 0 ? local.workspace_env : base.workspace_env,
    run: local.run ?? base.run,
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
  };
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
 */
async function expandPatterns(
  repoRoot: string,
  rel: string,
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
    ignore: ["**/.git/**", ".git"],
  });

  return matches.filter((m) => !m.split("/").includes(".git")).sort();
}

// ---------------------------------------------------------------------------
// Setup pipeline
// ---------------------------------------------------------------------------

/**
 * Execute the setup pipeline for a newly created worktree.
 *
 * Output is streamed line-by-line to the frontend via
 * `terminal:data:{setupSessionId}` events (base64 encoded).
 * Progress is reported via `workspace:setup_progress:{workspaceId}` events.
 *
 * Returns on success; throws a string describing the first step that failed.
 */
export async function runSetupPipeline(
  repoRoot: string,
  worktreePath: string,
  config: ArgusConfig,
  setupSessionId: string,
): Promise<void> {
  const workspaceId = setupSessionId.startsWith("setup:")
    ? setupSessionId.slice("setup:".length)
    : setupSessionId;

  info(
    `Setup pipeline started for workspace ${workspaceId}, repo_root=${repoRoot}, worktree=${worktreePath}`,
  );

  const progressEvent = `workspace:setup_progress:${workspaceId}`;

  const emit = (msg: string) => {
    const encoded = Buffer.from(msg).toString("base64");
    getMainWindow()?.webContents.send(
      `terminal:data:${setupSessionId}`,
      encoded,
    );
  };

  const emitProgressItem = (item: string, current: number, total: number) => {
    getMainWindow()?.webContents.send(progressEvent, {
      item,
      current,
      total,
    });
  };

  // Pre-compute all items to get total count for progress bar.
  const allItems: string[] = [];

  info("Setup pipeline: expanding copy patterns");
  for (const rel of config.setup.copy) {
    emitProgressItem(`Matching: ${rel}`, 0, 0);
    emit(`[argus] Matching pattern ${rel}...\r\n`);
    const expanded = filterNestedPaths(await expandPatterns(repoRoot, rel));
    if (expanded.length === 0) {
      emit(`[argus] Warning: ${rel} matched nothing, skipping.\r\n`);
    } else {
      allItems.push(...expanded);
    }
  }

  info("Setup pipeline: expanding symlink patterns");
  for (const rel of config.setup.symlink) {
    emitProgressItem(`Matching: ${rel}`, 0, 0);
    emit(`[argus] Matching pattern ${rel}...\r\n`);
    const expanded = filterNestedPaths(await expandPatterns(repoRoot, rel));
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
  for (const rel of config.setup.copy) {
    const expanded = filterNestedPaths(await expandPatterns(repoRoot, rel));
    if (expanded.length === 0) {
      continue;
    }

    for (const relPath of expanded) {
      const src = path.join(repoRoot, relPath);
      const dst = path.join(worktreePath, relPath);
      idx += 1;
      info(`Setup pipeline: copying [${idx}/${total}] ${relPath}`);
      emitProgressItem(relPath, idx, total);
      emit(`[argus] Copying ${relPath}...\r\n`);

      try {
        const stat = await fs.promises.stat(src);
        if (stat.isDirectory()) {
          await copyDirAll(src, dst);
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
  for (const rel of config.setup.symlink) {
    const expanded = filterNestedPaths(await expandPatterns(repoRoot, rel));
    if (expanded.length === 0) {
      emit(`[argus] Warning: ${rel} matched nothing, skipping.\r\n`);
      continue;
    }

    for (const relPath of expanded) {
      const src = path.join(repoRoot, relPath);
      const dst = path.join(worktreePath, relPath);
      idx += 1;
      info(`Setup pipeline: symlinking [${idx}/${total}] ${relPath}`);
      emitProgressItem(relPath, idx, total);
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
  info("Setup pipeline: starting commands phase");
  for (const cmdStr of config.setup.commands) {
    idx += 1;
    info(`Setup pipeline: running command [${idx}/${total}] ${cmdStr}`);
    emitProgressItem(cmdStr, idx, total);
    emit(`[argus] Running: ${cmdStr}\r\n`);

    let stdout = "";
    let stderr = "";
    let failed = false;
    let exitCode: number | null = null;

    try {
      const result = await execFileAsync("sh", ["-c", cmdStr], {
        cwd: worktreePath,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (e: unknown) {
      const err = e as {
        stdout?: string;
        stderr?: string;
        code?: number;
      };
      stdout = err.stdout ?? "";
      stderr = err.stderr ?? "";
      exitCode = err.code ?? null;
      failed = true;
    }

    for (const line of stdout.split("\n")) {
      if (line) {
        emit(`${line}\r\n`);
      }
    }
    for (const line of stderr.split("\n")) {
      if (line) {
        emit(`${line}\r\n`);
      }
    }

    if (failed) {
      emit(`[argus] Command failed (exit ${exitCode ?? "?"}): ${cmdStr}\r\n`);
      throw `Setup command failed: ${cmdStr}`;
    }

    info(`Setup pipeline: command completed: ${cmdStr}`);
  }

  info(`Setup pipeline: complete for workspace ${workspaceId}`);
  emit("[argus] Setup complete.\r\n");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively copy a directory tree from `src` to `dst`.
 *
 * Async so the main process event loop stays responsive — sync fs calls
 * on large trees (e.g. `node_modules`) freeze IPC and the renderer.
 * Symlinks are dereferenced to match the previous behaviour.
 */
async function copyDirAll(src: string, dst: string): Promise<void> {
  await fs.promises.cp(src, dst, {
    recursive: true,
    dereference: true,
    force: true,
  });
}

/** Returns true if `p` is a symlink (without throwing on missing path). */
function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
