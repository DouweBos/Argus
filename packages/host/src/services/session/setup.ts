/**
 * The worktree setup pipeline: copy, symlink, run commands.
 *
 * Reading `.argus.json` lives in `argusConfig.ts` — the pipeline needs a
 * terminal and the terminal needs the config, so keeping both here was a
 * cycle.
 */

import fg from "fast-glob";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { emitHostEvent } from "@argus/host/bus";
import { info } from "@argus/host/logger";
import { appState } from "../../state";
import {
  createTerminal,
  setupShellCommand,
  stripAnsi,
} from "../terminal/multiplexer";
import { type ArgusConfig, setupEntryExcludes, setupEntryPath } from "./models";
import { lastOutputLine, setSessionProgress } from "./progress";

const execFileAsync = promisify(execFile);

/** Give up on a setup command that has been silent this long (ms). */
const SETUP_IDLE_TIMEOUT_MS = 20 * 60 * 1000;

/** At most this often does a command's latest output line reach the UI (ms). */
const SETUP_DETAIL_INTERVAL_MS = 500;

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
  emitHostEvent(`session:setup_terminal:${sessionId}`, {
    terminalId,
    title: "Setup",
  });

  const progressEvent = `session:setup_progress:${sessionId}`;

  // Write decorated log lines directly to the terminal's output channel.
  // This bypasses the shell's stdin so our banners don't get echoed back by
  // the line editor and don't interfere with any command in flight.
  const emit = (msg: string) => {
    const encoded = Buffer.from(msg).toString("base64");
    emitHostEvent(`terminal:data:${terminalId}`, encoded);
  };

  interface SetupProgress {
    current: number;
    item: string;
    phase: "command" | "copy" | "matching" | "symlink";
    total: number;
  }
  let lastProgress: SetupProgress | null = null;
  const emitProgressItem = (
    item: string,
    current: number,
    total: number,
    phase: SetupProgress["phase"],
  ) => {
    lastProgress = { item, current, total, phase };
    emitHostEvent(progressEvent, lastProgress);
    if (total > 0) {
      // The running step isn't done yet, so it doesn't count.
      setSessionProgress(sessionId, { current: current - 1, total });
    }
  };

  // A long command would otherwise sit on one step with nothing moving,
  // which is indistinguishable from a hang.
  let lastDetailAt = 0;
  const emitProgressDetail = (output: string) => {
    const now = Date.now();
    if (!lastProgress || now - lastDetailAt < SETUP_DETAIL_INTERVAL_MS) {
      return;
    }
    const detail = lastOutputLine(output);
    // The shell echoes the command line, sentinel and all.
    if (!detail || detail.includes("__ARGUS_DONE_")) {
      return;
    }
    lastDetailAt = now;
    emitHostEvent(progressEvent, { ...lastProgress, detail });
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
        emitProgressDetail(stripAnsi(data));
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
