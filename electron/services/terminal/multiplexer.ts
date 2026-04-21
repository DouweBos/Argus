/**
 * PTY session registry for interactive terminal and agent sessions.
 *
 * Unlike node-pty's internal two-step approach, node-pty
 * spawns the child immediately on construction.  The equivalent two-step API
 * is therefore:
 *
 * 1. {@link createTerminal} — spawns the shell at 80×24, registers data/exit
 *    handlers that forward output to the renderer, stores the session.
 * 2. {@link startTerminal} — resizes the running PTY to the real dimensions
 *    reported by xterm.js after it has measured its container.
 *
 * This mirrors VSCode's approach and avoids the portable-pty "open then spawn"
 * ceremony that is not available in node-pty.
 *
 * # Event contract
 *
 * | Channel                       | Payload                  |
 * |-------------------------------|--------------------------|
 * | `terminal:data:{session_id}`  | Base64-encoded PTY bytes |
 * | `terminal:exit:{session_id}`  | Exit code (`number`)     |
 */

import type { RunCommand, WorkspaceEnvConfig } from "../session/models";
import type { IPty } from "node-pty";
import type * as NodePty from "node-pty";
import fs from "node:fs";
import path from "node:path";
import { getMainWindow } from "../../main";
import { appState } from "../../state";
import { loadArgusConfig } from "../session/setup";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pty = require("node-pty") as typeof NodePty;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single active PTY session. */
export interface TerminalSession {
  /** Unique identifier; also appears in event channel names. */
  id: string;
  /** The underlying node-pty instance. */
  pty: IPty;
  /** UUID of the session this session belongs to. */
  sessionId: string;
  /**
   * Optional label identifying the `run` command this session is executing.
   * Used by {@link createRunTerminal} to match restart-on-rerun semantics.
   */
  runTitle?: string;
  /**
   * When true, {@link terminalWrite} silently drops renderer-originated input.
   * Used by the setup pipeline so user keystrokes don't race with commands
   * being fed into the PTY's stdin while initialization is in progress.
   */
  locked?: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return the user's preferred shell, falling back to `/bin/sh`.
 */
export function defaultShell(): string {
  return process.env.SHELL ?? "/bin/sh";
}

/**
 * Compute a deterministic per-session integer from `sessionId` using a
 * simple djb2-style hash, bounded by `range`.
 *
 */
export function workspaceEnvValue(
  sessionId: string,
  envIndex: number | undefined,
  config: WorkspaceEnvConfig,
): number {
  const strategy = config.strategy ?? "hash";
  const baseValue = config.base_value ?? 8081;
  const range = config.range && config.range !== 0 ? config.range : 1000;

  if (strategy === "sequential") {
    return baseValue + (envIndex ?? 0);
  }

  // Hash strategy: djb2 over the UTF-8 bytes of sessionId, mod range.
  let hash = 5381;
  for (let i = 0; i < sessionId.length; i++) {
    // Equivalent to: hash = ((hash << 5) + hash) + charCode
    hash = Math.imul(hash, 33) ^ sessionId.charCodeAt(i);
  }
  // Ensure non-negative before modulo.
  const offset = Math.abs(hash) % range;

  return baseValue + offset;
}

/**
 * Build any extra environment variables that should be injected into a
 * session terminal.
 *
 */
function buildWorkspaceEnv(
  sessionId: string,
  sessionKind: "org_host" | "project_root" | "worktree",
  envIndex: number | undefined,
  repoRoot: string,
): Record<string, string> {
  const extra: Record<string, string> = {};

  // workspace_env only applies to worktree sessions, not the repo root or
  // neutral org-host sessions.
  if (sessionKind === "project_root" || sessionKind === "org_host") {
    return extra;
  }

  try {
    const config = loadArgusConfig(repoRoot);
    for (const we of config.workspace_env) {
      if (we.name) {
        const value = workspaceEnvValue(sessionId, envIndex, we);
        extra[we.name] = String(value);
      }
    }
  } catch {
    // Missing or unparseable .argus.json is non-fatal.
  }

  return extra;
}

// ---------------------------------------------------------------------------
// IPC-facing functions
// ---------------------------------------------------------------------------

/**
 * Spawn a PTY running the session's shell (or a one-shot command), register
 * data and exit event handlers, and store the session in {@link appState}.
 *
 * The PTY is spawned at 80×24; call {@link startTerminal} once xterm.js has
 * measured its container to resize it to the real dimensions.
 *
 * @param sessionId - UUID of the owning session.
 * @param subDir      - Optional subdirectory (relative to the session root)
 *                      to use as the working directory.
 * @param command     - Optional one-shot command; if omitted, the user's login
 *                      shell is spawned interactively.
 * @returns The new session ID.
 * @throws A plain string if the session is not found or the PTY fails to
 *         spawn.
 */
export function createTerminal(
  sessionId: string,
  subDir?: string,
  command?: string,
): string {
  const ws = appState.sessions.get(sessionId);
  if (!ws) {
    throw `Session not found: ${sessionId}`;
  }

  // Resolve working directory.
  let cwd: string = ws.path;
  if (subDir) {
    const joined = path.join(ws.path, subDir);
    if (!fs.existsSync(joined)) {
      throw `Sub-directory does not exist: ${joined}`;
    }
    cwd = joined;
  }

  // Build session-specific environment extras.
  const extraEnv = buildWorkspaceEnv(
    sessionId,
    ws.kind,
    ws.env_index ?? undefined,
    ws.repo_root,
  );

  // Determine the program and arguments.
  const [program, args]: [string, string[]] = command
    ? ["sh", ["-c", command]]
    : [defaultShell(), []];

  const terminalId = crypto.randomUUID();

  // node-pty requires all env values to be defined strings — filter out any
  // undefined entries from process.env to avoid posix_spawnp failures.
  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) {
      cleanEnv[k] = v;
    }
  }
  // Advertise 24-bit color support so TUIs (nvim, bat, fzf, delta, …) enable
  // truecolor rendering. `TERM` is set to xterm-256color below via node-pty.
  if (!cleanEnv.COLORTERM) {
    cleanEnv.COLORTERM = "truecolor";
  }
  // Let tools identify the host terminal (git config hints, shell rc logic,
  // etc.). Distinct from `TERM`, which describes capabilities.
  if (!cleanEnv.TERM_PROGRAM) {
    cleanEnv.TERM_PROGRAM = "Argus";
  }
  Object.assign(cleanEnv, extraEnv);

  const ptyProcess: IPty = pty.spawn(program, args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd,
    env: cleanEnv,
  });

  // Coalesce PTY output on a short timer. Under heavy load (yarn/pnpm install,
  // verbose builds) node-pty emits many small chunks — batching them drops
  // IPC event count ~10–100× with no perceptible latency cost.
  let pendingChunks: string[] = [];
  let flushTimer: NodeJS.Timeout | null = null;
  const FLUSH_INTERVAL_MS = 8;

  const flush = (): void => {
    if (pendingChunks.length === 0) {
      return;
    }
    const combined = pendingChunks.join("");
    pendingChunks = [];
    getMainWindow()?.webContents.send(
      `terminal:data:${terminalId}`,
      Buffer.from(combined).toString("base64"),
    );
  };

  // Forward PTY output to the renderer as base64-encoded chunks.
  ptyProcess.onData((data: string) => {
    pendingChunks.push(data);
    if (flushTimer === null) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flush();
      }, FLUSH_INTERVAL_MS);
      // Keep timer from holding the event loop open on app shutdown.
      flushTimer.unref?.();
    }
  });

  // Forward exit notification to the renderer.
  ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
    // Drain any buffered output before signalling exit so the renderer sees
    // trailing bytes (e.g. a failing command's last line) before the close.
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flush();
    getMainWindow()?.webContents.send(`terminal:exit:${terminalId}`, exitCode);
    // Clean up state when the process exits on its own.
    appState.terminals.delete(terminalId);
  });

  const terminal: TerminalSession = {
    id: terminalId,
    pty: ptyProcess,
    sessionId,
  };

  appState.terminals.set(terminalId, terminal);

  return terminalId;
}

/**
 * Resolve a `RunCommand` from a session's `.argus.json`. If `title` is
 * supplied, matches by title; otherwise returns the first command. Throws a
 * plain string if no run commands are configured or the requested title
 * isn't found.
 */
export function resolveRunCommand(
  sessionId: string,
  title?: string,
): RunCommand {
  const ws = appState.sessions.get(sessionId);
  if (!ws) {
    throw `Session not found: ${sessionId}`;
  }

  const config = loadArgusConfig(ws.repo_root);
  if (!config.run || config.run.length === 0) {
    throw "No 'run' commands configured in .argus.json";
  }

  if (!title) {
    return config.run[0];
  }
  const match = config.run.find((r) => r.title === title);
  if (!match) {
    throw `No run command with title '${title}' in .argus.json`;
  }

  return match;
}

/**
 * Spawn a terminal running one of the session's configured `run` commands
 * from `.argus.json`. The command is resolved entirely server-side — the
 * renderer (and any code reaching this IPC) cannot supply an arbitrary shell
 * command, which closes the XSS-to-RCE chain via `create_terminal`.
 *
 * If `title` is supplied, the matching entry is used; otherwise the first
 * entry runs. When the selected entry has `restartOnRerun: true`, any live
 * session with the same title in the same session is killed first. When
 * `restartOnRerun` is false and a matching live session exists, its ID is
 * returned as-is without spawning a new one.
 *
 * @returns An object with the session id and whether a new session was
 *          actually started (vs. reusing an existing one).
 *
 * TODO: once the new graceful `stopTerminal` / signal-escalation work from the
 * terminal-stop branch lands, swap the `destroyTerminal` call below for it so
 * restart kills are not SIGKILL-hammered.
 */
export function createRunTerminal(
  sessionId: string,
  title?: string,
): { sessionId: string; started: boolean; title: string } {
  const runCmd = resolveRunCommand(sessionId, title);

  const existing = findRunSession(sessionId, runCmd.title);
  if (existing) {
    if (!runCmd.restartOnRerun) {
      return { sessionId: existing.id, started: false, title: runCmd.title };
    }
    try {
      destroyTerminal(existing.id);
    } catch {
      // non-fatal; the session may have exited between the lookup and kill.
    }
  }

  const terminalId = createTerminal(sessionId, runCmd.cwd, runCmd.command);
  const terminal = appState.terminals.get(terminalId);
  if (terminal) {
    terminal.runTitle = runCmd.title;
  }

  return { sessionId: terminalId, started: true, title: runCmd.title };
}

/** Look up an alive run-terminal session for this session + title. */
function findRunSession(
  sessionId: string,
  title: string,
): TerminalSession | null {
  for (const session of appState.terminals.values()) {
    if (session.sessionId === sessionId && session.runTitle === title) {
      return session;
    }
  }

  return null;
}

/**
 * Resize the PTY to the real terminal dimensions reported by xterm.js.
 *
 * Call this once after xterm.js has mounted and measured its container.
 * The shell's line editor will reflow to the new geometry on the next
 * `SIGWINCH` delivery.
 *
 * @throws A plain string if the session is not found.
 */
export function startTerminal(
  sessionId: string,
  cols: number,
  rows: number,
): void {
  const session = appState.terminals.get(sessionId);
  if (!session) {
    throw `Terminal session not found: ${sessionId}`;
  }
  session.pty.resize(cols, rows);
}

/**
 * Kill a PTY session and remove it from the registry.
 *
 * Sends a `terminal:exit` event with code `-1` to inform the renderer that
 * the session was destroyed from the main process side.
 *
 * @throws A plain string if the session is not found.
 */
export function destroyTerminal(sessionId: string): void {
  const session = appState.terminals.get(sessionId);
  if (!session) {
    throw `Terminal session not found: ${sessionId}`;
  }

  try {
    session.pty.kill();
  } catch {
    // The process may have already exited; treat as non-fatal.
  }

  appState.terminals.delete(sessionId);

  // Notify the renderer that the session has ended.
  getMainWindow()?.webContents.send(`terminal:exit:${sessionId}`, -1);
}

/**
 * Gracefully stop a PTY session by escalating signals: SIGINT → SIGTERM →
 * SIGKILL, with ~1.5s between each step. Returns immediately; the escalation
 * runs in the background and stops as soon as the process exits (the
 * `onExit` handler removes the session from the registry).
 *
 * Unlike {@link destroyTerminal}, this gives well-behaved processes a chance
 * to clean up. Use this for user-triggered stop actions (e.g. a Stop button);
 * use {@link destroyTerminal} for hard teardown when the renderer is closing
 * a tab.
 *
 * @throws A plain string if the session is not found.
 */
export function stopTerminal(sessionId: string): void {
  const session = appState.terminals.get(sessionId);
  if (!session) {
    throw `Terminal session not found: ${sessionId}`;
  }

  const escalate = (signal: "SIGINT" | "SIGKILL" | "SIGTERM"): boolean => {
    if (!appState.terminals.has(sessionId)) {
      return false;
    }
    try {
      session.pty.kill(signal);
    } catch {
      // Process may have already exited between checks; treat as done.
      return false;
    }

    return true;
  };

  if (!escalate("SIGINT")) {
    return;
  }

  const termTimer = setTimeout(() => {
    if (!escalate("SIGTERM")) {
      return;
    }
    const killTimer = setTimeout(() => {
      escalate("SIGKILL");
    }, 1500);
    // Don't keep the event loop alive for escalation during app shutdown.
    killTimer.unref?.();
  }, 1500);
  termTimer.unref?.();
}

/**
 * Destroy every registered terminal. Intended for `before-quit` cleanup so
 * long-running `run` commands (dev servers, Metro, watchers) and any detached
 * grandchildren they spawned are torn down rather than relying on PTY-master
 * close → SIGHUP, which some processes ignore or survive.
 */
export function destroyAllTerminals(): void {
  for (const id of Array.from(appState.terminals.keys())) {
    try {
      destroyTerminal(id);
    } catch {
      // non-fatal — best-effort cleanup during shutdown.
    }
  }
}

/**
 * Write raw bytes (base64-encoded) to a PTY session's stdin.
 *
 * `data` is base64-encoded so that arbitrary binary sequences (escape codes,
 * arrow keys, etc.) survive JSON transport cleanly.
 *
 * @throws A plain string if the session is not found or the base64 is invalid.
 */
export function terminalWrite(sessionId: string, data: string): void {
  const session = appState.terminals.get(sessionId);
  if (!session) {
    throw `Terminal session not found: ${sessionId}`;
  }
  if (session.locked) {
    return;
  }
  const raw = Buffer.from(data, "base64");
  // Decode as "binary" (latin1) rather than the default UTF-8 so byte values
  // survive 1:1 into the PTY. This preserves non-UTF-8 pastes and raw escape
  // sequences; node-pty's write API only accepts strings, so this is the
  // closest approximation to passing bytes through unchanged.
  session.pty.write(raw.toString("binary"));
}

/**
 * Resize the PTY window for an already-running session.
 *
 * @throws A plain string if the session is not found.
 */
export function terminalResize(
  sessionId: string,
  cols: number,
  rows: number,
): void {
  const session = appState.terminals.get(sessionId);
  if (!session) {
    throw `Terminal session not found: ${sessionId}`;
  }
  session.pty.resize(cols, rows);
}
