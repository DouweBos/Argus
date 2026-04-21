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
import { appState } from "../../state";
import { createTerminal } from "../terminal/multiplexer";
import {
  type BrowserPresetConfig,
  defaultArgusConfig,
  type RelatedProject,
  type RunCommand,
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
    protected_branches: normalizeProtectedBranches(parsed.protected_branches),
  };
}

/**
 * Normalise `protected_branches` from `.argus.json`. Accepts a string array
 * of branch names that cannot be merged into directly from the app. Empty /
 * missing / malformed values return `[]` (no protection).
 */
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

    return {
      title,
      command,
      cwd: typeof obj.cwd === "string" && obj.cwd ? obj.cwd : undefined,
      restartOnRerun: Boolean(obj.restartOnRerun),
    };
  });
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
  };
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
    terminalId = createTerminal(sessionId);
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

  const emitProgressItem = (item: string, current: number, total: number) => {
    getMainWindow()?.webContents.send(progressEvent, {
      item,
      current,
      total,
    });
  };

  // Run a single setup command inside the PTY and resolve with its exit code.
  // We append a printf that emits a unique sentinel containing `$?`, then
  // scan the PTY output stream for it. The sentinel matches POSIX sh / bash /
  // zsh; fish (and other non-POSIX shells) as $SHELL will hang — acceptable
  // limitation for v1 since setup typically runs via sh-style shells.
  const runInPty = (cmd: string): Promise<number> =>
    new Promise((resolve) => {
      const token = crypto.randomUUID().replace(/-/g, "");
      const sentinel = `__ARGUS_DONE_${token}__`;
      const re = new RegExp(`${sentinel}:(\\d+)`);
      let buffer = "";
      const disposable = setupPty.onData((data: string) => {
        buffer += data;
        const match = buffer.match(re);
        if (match) {
          disposable.dispose();
          resolve(parseInt(match[1], 10));

          return;
        }
        if (buffer.length > 64 * 1024) {
          buffer = buffer.slice(-32 * 1024);
        }
      });
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
    // exec the login shell so it replaces this `sh` process in-place.
    setupPty.write(`exec ${userShell} -l\n`);
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
    // Drive each command through the setup PTY. Output streams naturally via
    // the terminal's data channel, so nothing to re-emit here. If a command
    // prompts for input, the user can type into the visible tab and unblock it.
    info("Setup pipeline: starting commands phase");
    for (const cmdStr of config.setup.commands) {
      idx += 1;
      info(`Setup pipeline: running command [${idx}/${total}] ${cmdStr}`);
      emitProgressItem(cmdStr, idx, total);
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
async function copyDirAll(src: string, dst: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(dst), { recursive: true });
  // If dst exists, remove it first so the copy overwrites cleanly rather than
  // landing src *inside* dst.
  if (fs.existsSync(dst)) {
    await fs.promises.rm(dst, { recursive: true, force: true });
  }
  // Trailing slash on src tells rsync to copy the contents of src into dst
  // (matching `cp -R src dst` semantics where dst doesn't yet exist).
  await execFileAsync("rsync", ["-a", `${src}/`, dst]);
}

/** Returns true if `p` is a symlink (without throwing on missing path). */
function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
