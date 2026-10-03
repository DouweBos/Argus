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

import type {
  RunCommand,
  SessionKind,
  WorkspaceEnvConfig,
} from "../session/models";
import type { IPty } from "node-pty";
import type * as NodePty from "node-pty";
import fs from "node:fs";
import path from "node:path";
import { emitHostEvent } from "@argus/host/bus";
import { warn } from "@argus/host/logger";
import { appState } from "../../state";
import {
  envForAccount,
  resolveAccountForSession,
} from "../claudeAuth/accounts";
import { loadArgusConfig } from "../session/argusConfig";

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
  /**
   * OS pid captured at spawn time. Kept separately from `pty.pid` so we can
   * still issue a backstop `process.kill(pid, 'SIGKILL')` after `pty.kill()`
   * — node-pty's kill closes the master fd, which sends SIGHUP to the shell
   * but doesn't reap the spawn-helper shim if it hasn't exec'd yet. Without
   * the backstop those helpers reparent to launchd and accumulate over
   * Argus restarts.
   */
  pid: number;
  /** UUID of the session this session belongs to. */
  sessionId: string;
  /**
   * Renderer-supplied display label for the terminal tab. Persisted in main
   * so the renderer can rehydrate tabs after a window reload without losing
   * the user's chosen names.
   */
  title?: string;
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
  /**
   * Rolling capture of recent PTY output, capped at {@link MAX_OUTPUT_BYTES}.
   * Used by {@link readTerminalOutput} / {@link waitForTerminal} so MCP-driven
   * agents can inspect a runtime they triggered. Older bytes are dropped from
   * the front when the cap is hit.
   */
  outputLog: string;
  /** Total bytes ever written to the PTY (pre-cap). */
  outputTotalBytes: number;
  /** Bytes that have been dropped from the front of {@link outputLog}. */
  outputDroppedBytes: number;
  /**
   * Tail of {@link outputLog} not yet broadcast as `terminal:data`, so a
   * scrollback read hands over exactly what the live events don't.
   */
  unflushedChars: number;
  /**
   * Exit code once the PTY has closed. `null` while the process is still
   * running. We deliberately keep exited entries in the registry so that
   * post-exit reads (e.g. an agent calling `read_terminal` after a quick
   * one-shot has finished) still return its output.
   */
  exitCode: number | null;
  /** Wall-clock ms timestamp of exit, or `null` while still running. */
  exitedAt: number | null;
  /** Pending {@link waitForTerminal} resolvers. Drained on match or exit. */
  waiters: TerminalWaiter[];
}

interface TerminalWaiter {
  predicate: ((output: string) => boolean) | null;
  resolve: (result: TerminalWaitResult) => void;
  timer: NodeJS.Timeout | null;
}

/** Result of a {@link waitForTerminal} call. */
export interface TerminalWaitResult {
  reason: "exit" | "match" | "timeout";
  exitCode: number | null;
  output: string;
  totalBytes: number;
  droppedBytes: number;
}

/** Snapshot returned by {@link listTerminals} so the renderer can rehydrate tab state after a window reload. */
export interface TerminalSummary {
  id: string;
  sessionId: string;
  title: string | null;
  runTitle: string | null;
  exited: boolean;
  exitCode: number | null;
}

/** Result of a {@link readTerminalOutput} call. */
export interface TerminalReadResult {
  running: boolean;
  exitCode: number | null;
  output: string;
  totalBytes: number;
  droppedBytes: number;
  runTitle: string | null;
  sessionId: string;
}

/** What a client replays when it reattaches to a terminal. */
export interface TerminalScrollback {
  /** Base64 UTF-8 of the output broadcast so far, up to the capture cap. */
  data: string;
  /** Whether older output was dropped, so the replay starts mid-stream. */
  truncated: boolean;
  exited: boolean;
  exitCode: number | null;
}

/** Hard cap on per-terminal captured output (bytes). */
const MAX_OUTPUT_BYTES = 256 * 1024;
/** Default tail size returned by {@link readTerminalOutput}. */
const DEFAULT_TAIL_BYTES = 16 * 1024;
/** Hard cap on a single {@link waitForTerminal} timeout. */
const MAX_WAIT_MS = 10 * 60 * 1000;

/**
 * Strip ANSI CSI / OSC escape sequences from `s`. Run-command output is full
 * of color codes, cursor moves, and progress redraws that bloat the response
 * and confuse pattern matching. We strip them by default for MCP reads.
 */
export function stripAnsi(s: string): string {
  // CSI sequences (colors, cursor, erase, etc.) and OSC sequences (titles,
  // hyperlinks). Covers the vast majority of what dev servers emit.
  // ESC is intentional in these regexes — that's exactly what we're matching.
  /* eslint-disable no-control-regex */
  return s
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[=>]/g, "");
  /* eslint-enable no-control-regex */
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * The user's preferred shell, falling back to `/bin/sh`.
 *
 * `$SHELL` is checked against the filesystem rather than trusted: it is
 * inherited from whatever launched us and routinely names a shell that is not
 * installed here — a CI image exporting `/bin/zsh` it does not ship, a
 * migrated dotfile, a container. Spawning it fails deep inside node-pty as a
 * bare `posix_spawnp failed`, which says nothing about the cause.
 */
export function defaultShell(): string {
  const preferred = process.env.SHELL;
  if (preferred && path.isAbsolute(preferred) && fs.existsSync(preferred)) {
    return preferred;
  }
  if (preferred) {
    warn(`SHELL is set to ${preferred}, which does not exist — using /bin/sh`);
  }

  return "/bin/sh";
}

/**
 * Resolve the program + args for a one-shot command.
 *
 * Runs as an *interactive* login shell (`-ilc`) so `~/.zshrc` version-manager
 * hooks (mise, rbenv, nvm, …) apply. Login-only would let `/etc/zprofile`'s
 * `path_helper` push `/usr/bin` ahead of the shims, so `bundle`/`ruby` would
 * resolve to the system copies. Then `exec sh -c` on the command itself: it
 * travels as a positional parameter so the login shell never parses it — zsh
 * would otherwise choke on things like `--filter ~mobile-native` (named-directory
 * expansion).
 */
export function commandShell(command: string): [string, string[]] {
  const shell = defaultShell();
  const name = path.basename(shell);

  if (name === "zsh" || name === "bash" || name === "ksh") {
    return [shell, ["-ilc", 'exec sh -c "$0"', command]];
  }
  if (name === "fish") {
    return [shell, ["-ilc", 'exec sh -c "$argv[1]"', command]];
  }

  // Unknown shell — run the command directly under `sh`, no login env.
  return ["sh", ["-c", command]];
}

/**
 * Command that turns a setup PTY into a shell the pipeline can safely feed
 * commands to, one line at a time.
 *
 * The setup terminal must load the user's rc files (version-manager shims), so
 * it starts as an interactive login shell — but an interactive *line editor*
 * (zsh's zle plus prompt frameworks like powerlevel10k) redraws and reorders
 * whatever we write into it. A long command written just as the previous one
 * finished can end up split across the prompt redraw, so its trailing
 * `; printf SENTINEL` half is left sitting at the prompt unsubmitted and setup
 * waits forever. Handing off to a shell with line editing disabled keeps the
 * tty (and the rc-loaded environment) while making written lines arrive
 * verbatim through the kernel's canonical input buffer.
 */
export function setupShellCommand(): string {
  const bash = fs.existsSync("/bin/bash") ? "/bin/bash" : null;
  if (bash) {
    return `PS1= ; export PS1; exec ${bash} --noediting --norc --noprofile -i`;
  }

  return "PS1= ; export PS1; exec /bin/sh";
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
  sessionKind: SessionKind,
  envIndex: number | undefined,
  repoRoot: string,
): Record<string, string> {
  const extra: Record<string, string> = {};

  // workspace_env only applies to worktree sessions.
  if (sessionKind !== "worktree") {
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
  title?: string,
): string {
  const ws = appState.sessions.get(sessionId);
  if (!ws) {
    throw `Session not found: ${sessionId}`;
  }
  // Pending sessions don't have a worktree on disk yet. node-pty would
  // spawn the shell in `process.cwd()` (the Argus app root) which is wildly
  // wrong — refuse instead so callers retry once setup finishes.
  if (!ws.path) {
    throw `Session ${sessionId} is still initializing`;
  }

  // Opportunistic GC of long-exited terminal entries we kept around for
  // post-exit reads.
  sweepExitedTerminals();

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
    ? commandShell(command)
    : [defaultShell(), []];

  const terminalId = crypto.randomUUID();

  // node-pty requires all env values to be defined strings — filter out any
  // undefined entries from process.env to avoid posix_spawnp failures. The
  // account overlay makes `claude` in this terminal use the same account as
  // the session's agents.
  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(
    envForAccount(resolveAccountForSession(ws)),
  )) {
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

  // Goes through the broadcast bus, not the main window, so remote clients
  // (and popouts) see PTY output too.
  const flush = (): void => {
    if (pendingChunks.length === 0) {
      return;
    }
    const combined = pendingChunks.join("");
    pendingChunks = [];
    terminal.unflushedChars = 0;
    emitHostEvent(
      `terminal:data:${terminalId}`,
      Buffer.from(combined).toString("base64"),
    );
  };

  const terminal: TerminalSession = {
    id: terminalId,
    pty: ptyProcess,
    pid: ptyProcess.pid,
    sessionId,
    title,
    outputLog: "",
    outputTotalBytes: 0,
    outputDroppedBytes: 0,
    unflushedChars: 0,
    exitCode: null,
    exitedAt: null,
    waiters: [],
  };

  appState.terminals.set(terminalId, terminal);

  // Forward PTY output to the renderer as base64-encoded chunks, and append
  // to the in-memory capture so MCP `read_terminal` / `wait_for_terminal`
  // can inspect runtime output later. The capture is bounded; older bytes
  // are dropped from the front once {@link MAX_OUTPUT_BYTES} is exceeded.
  ptyProcess.onData((data: string) => {
    pendingChunks.push(data);
    terminal.unflushedChars += data.length;
    terminal.outputTotalBytes += data.length;
    terminal.outputLog += data;
    if (terminal.outputLog.length > MAX_OUTPUT_BYTES) {
      const overflow = terminal.outputLog.length - MAX_OUTPUT_BYTES;
      terminal.outputLog = terminal.outputLog.slice(overflow);
      terminal.outputDroppedBytes += overflow;
    }
    notifyWaiters(terminal);
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
    // For run-commands (configured in `.argus.json`), append an explicit
    // exit-status line. Build commands often end on a noisy "building…"
    // print, leaving the user unable to tell whether the run finished.
    if (terminal.runTitle) {
      const color = exitCode === 0 ? "\x1b[1;32m" : "\x1b[1;31m";
      const label =
        exitCode === 0 ? "exited cleanly" : `exited with code ${exitCode}`;
      const line = `\r\n${color}— ${terminal.runTitle} ${label}\x1b[0m\r\n`;
      terminal.outputTotalBytes += line.length;
      terminal.outputLog += line;
      if (terminal.outputLog.length > MAX_OUTPUT_BYTES) {
        const overflow = terminal.outputLog.length - MAX_OUTPUT_BYTES;
        terminal.outputLog = terminal.outputLog.slice(overflow);
        terminal.outputDroppedBytes += overflow;
      }
      emitHostEvent(
        `terminal:data:${terminalId}`,
        Buffer.from(line).toString("base64"),
      );
    }
    terminal.exitCode = exitCode;
    terminal.exitedAt = Date.now();
    emitHostEvent(`terminal:exit:${terminalId}`, exitCode);
    // Wake any pending waiters so they unblock immediately. We deliberately
    // KEEP the entry in `appState.terminals` after exit so that follow-up
    // reads still return the captured output and exit code; entries are
    // garbage-collected by {@link sweepExitedTerminals}, by an explicit
    // {@link destroyTerminal}, or when the parent session is deleted.
    notifyWaiters(terminal);
  });

  return terminalId;
}

/**
 * Notify pending {@link waitForTerminal} resolvers. Called after every output
 * append and on exit. Each waiter's predicate is checked against the current
 * captured log; matches resolve with `reason: "match"`. Once exited, all
 * remaining waiters resolve with `reason: "exit"`.
 */
function notifyWaiters(terminal: TerminalSession): void {
  if (terminal.waiters.length === 0) {
    return;
  }
  const remaining: TerminalWaiter[] = [];
  for (const w of terminal.waiters) {
    if (terminal.exitCode !== null) {
      if (w.timer) {
        clearTimeout(w.timer);
      }
      w.resolve({
        reason: "exit",
        exitCode: terminal.exitCode,
        output: terminal.outputLog,
        totalBytes: terminal.outputTotalBytes,
        droppedBytes: terminal.outputDroppedBytes,
      });
      continue;
    }
    if (w.predicate && w.predicate(terminal.outputLog)) {
      if (w.timer) {
        clearTimeout(w.timer);
      }
      w.resolve({
        reason: "match",
        exitCode: null,
        output: terminal.outputLog,
        totalBytes: terminal.outputTotalBytes,
        droppedBytes: terminal.outputDroppedBytes,
      });
      continue;
    }
    remaining.push(w);
  }
  terminal.waiters = remaining;
}

/**
 * Read captured output from a terminal session. Returns the tail of the
 * captured log (defaulting to {@link DEFAULT_TAIL_BYTES}) along with the
 * running/exit state. Strips ANSI escape sequences by default.
 *
 * @throws A plain string if the terminal session is not found.
 */
export function readTerminalOutput(
  terminalId: string,
  options?: {
    tailBytes?: number;
    stripAnsi?: boolean;
  },
): TerminalReadResult {
  const terminal = appState.terminals.get(terminalId);
  if (!terminal) {
    throw `Terminal session not found: ${terminalId}`;
  }
  const tail = options?.tailBytes ?? DEFAULT_TAIL_BYTES;
  const strip = options?.stripAnsi ?? true;

  let output = terminal.outputLog;
  if (tail > 0 && output.length > tail) {
    output = output.slice(output.length - tail);
  }
  if (strip) {
    output = stripAnsi(output);
  }

  return {
    running: terminal.exitCode === null,
    exitCode: terminal.exitCode,
    output,
    totalBytes: terminal.outputTotalBytes,
    droppedBytes: terminal.outputDroppedBytes,
    runTitle: terminal.runTitle ?? null,
    sessionId: terminal.sessionId,
  };
}

/**
 * The captured output a reattaching client replays before its live
 * `terminal:data` events. Output still waiting for the next flush is left out
 * — that event is on its way — so replay plus events never repeat a byte.
 * A truncated capture starts at its first full line, not mid escape sequence.
 *
 * @throws A plain string if the terminal session is not found.
 */
export function terminalScrollback(terminalId: string): TerminalScrollback {
  const terminal = appState.terminals.get(terminalId);
  if (!terminal) {
    throw `Terminal session not found: ${terminalId}`;
  }
  const flushed = Math.max(
    terminal.outputLog.length - terminal.unflushedChars,
    0,
  );
  let output = terminal.outputLog.slice(0, flushed);
  const truncated = terminal.outputDroppedBytes > 0;
  if (truncated) {
    const newline = output.indexOf("\n");
    output = newline === -1 ? "" : output.slice(newline + 1);
  }

  return {
    data: Buffer.from(output).toString("base64"),
    truncated,
    exited: terminal.exitCode !== null,
    exitCode: terminal.exitCode,
  };
}

/**
 * Wait for a terminal session to either:
 *
 * - emit captured output matching `untilPattern` (regex tested against the
 *   ANSI-stripped log), or
 * - exit, or
 * - hit `timeoutMs`.
 *
 * Resolves with the reason and the captured output snapshot. Useful for
 * agents that want to wait until a dev server is "ready" or for a one-shot
 * command to finish. If the terminal has already exited, resolves
 * immediately with `reason: "exit"`.
 *
 * @throws A plain string if the terminal session is not found.
 */
export function waitForTerminal(
  terminalId: string,
  options?: {
    untilPattern?: string;
    timeoutMs?: number;
  },
): Promise<TerminalWaitResult> {
  const terminal = appState.terminals.get(terminalId);
  if (!terminal) {
    throw `Terminal session not found: ${terminalId}`;
  }

  // Already exited — resolve synchronously with the captured output.
  if (terminal.exitCode !== null) {
    return Promise.resolve({
      reason: "exit",
      exitCode: terminal.exitCode,
      output: terminal.outputLog,
      totalBytes: terminal.outputTotalBytes,
      droppedBytes: terminal.outputDroppedBytes,
    });
  }

  let predicate: ((output: string) => boolean) | null = null;
  if (options?.untilPattern) {
    let re: RegExp;
    try {
      re = new RegExp(options.untilPattern);
    } catch (e) {
      return Promise.reject(`Invalid until_pattern regex: ${String(e)}`);
    }
    predicate = (output) => re.test(stripAnsi(output));
    // The pattern may already be present in output captured before we
    // attached — short-circuit so callers don't hang waiting for a
    // re-emission.
    if (predicate(terminal.outputLog)) {
      return Promise.resolve({
        reason: "match",
        exitCode: null,
        output: terminal.outputLog,
        totalBytes: terminal.outputTotalBytes,
        droppedBytes: terminal.outputDroppedBytes,
      });
    }
  }

  const timeout = Math.min(
    Math.max(options?.timeoutMs ?? 30_000, 0),
    MAX_WAIT_MS,
  );

  return new Promise<TerminalWaitResult>((resolve) => {
    const waiter: TerminalWaiter = {
      predicate,
      resolve,
      timer: null,
    };
    if (timeout > 0) {
      waiter.timer = setTimeout(() => {
        // Drop this waiter from the queue and resolve with a timeout result.
        terminal.waiters = terminal.waiters.filter((w) => w !== waiter);
        resolve({
          reason: "timeout",
          exitCode: terminal.exitCode,
          output: terminal.outputLog,
          totalBytes: terminal.outputTotalBytes,
          droppedBytes: terminal.outputDroppedBytes,
        });
      }, timeout);
      waiter.timer.unref?.();
    }
    terminal.waiters.push(waiter);
  });
}

/**
 * Drop registry entries for terminals that exited more than `maxAgeMs` ago.
 * Called opportunistically from {@link createTerminal} so the registry
 * doesn't grow unbounded across long-lived sessions.
 */
function sweepExitedTerminals(maxAgeMs = 30 * 60 * 1000): void {
  const now = Date.now();
  for (const [id, t] of appState.terminals) {
    if (t.exitedAt !== null && now - t.exitedAt > maxAgeMs) {
      appState.terminals.delete(id);
    }
  }
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
    throw "No 'run' commands configured in .argus.json — ask the user to add one before trying to start the runtime.";
  }

  if (!title) {
    return config.run[0];
  }
  const match = config.run.find((r) => r.title === title);
  if (!match) {
    const available = config.run.map((r) => `'${r.title}'`).join(", ");
    throw `No run command with title '${title}' in .argus.json. Available: ${available}.`;
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
 * If the entry declares `requires`, any missing dependency is started
 * recursively before the entry itself spawns. Cycles in the `requires`
 * chain are detected and rejected.
 *
 * @returns An object with the session id and whether a new session was
 *          actually started (vs. reusing an existing one).
 *
 * TODO: once the new graceful `stopTerminal` / signal-escalation work from the
 * terminal-stop branch lands, swap the `destroyTerminal` call below for it so
 * restart kills are not SIGKILL-hammered.
 */
export interface RunTerminalResult {
  sessionId: string;
  started: boolean;
  title: string;
  /**
   * Dependencies that were auto-spawned to satisfy this entry's `requires`
   * chain, in dependency-first order. Already-running dependencies are not
   * included — only newly created terminals. The renderer needs these to
   * register tabs and attach output listeners; without them the PTY runs
   * invisibly in main.
   */
  dependencies: { sessionId: string; title: string }[];
}

export function createRunTerminal(
  sessionId: string,
  title?: string,
  visiting = new Set<string>(),
): RunTerminalResult {
  const runCmd = resolveRunCommand(sessionId, title);

  if (visiting.has(runCmd.title)) {
    throw `Cannot start '${runCmd.title}' — circular dependency detected in 'requires' chain: ${[
      ...visiting,
      runCmd.title,
    ]
      .map((t) => `'${t}'`)
      .join(" → ")}.`;
  }

  const dependencies: { sessionId: string; title: string }[] = [];
  if (runCmd.requires && runCmd.requires.length > 0) {
    const nextVisiting = new Set(visiting);
    nextVisiting.add(runCmd.title);
    for (const req of runCmd.requires) {
      if (findRunSession(sessionId, req)) {
        continue;
      }
      const depResult = createRunTerminal(sessionId, req, nextVisiting);
      // Surface the entire transitive chain so the renderer registers tabs
      // for every newly-spawned terminal, not just the direct dependency.
      for (const transitive of depResult.dependencies) {
        dependencies.push(transitive);
      }
      if (depResult.started) {
        dependencies.push({
          sessionId: depResult.sessionId,
          title: depResult.title,
        });
      }
    }
  }

  const existing = findRunSession(sessionId, runCmd.title);
  if (existing) {
    if (!runCmd.restartOnRerun) {
      return {
        sessionId: existing.id,
        started: false,
        title: runCmd.title,
        dependencies,
      };
    }
    try {
      destroyTerminal(existing.id);
    } catch {
      // non-fatal; the session may have exited between the lookup and kill.
    }
  }

  const terminalId = createTerminal(
    sessionId,
    runCmd.cwd,
    runCmd.command,
    runCmd.title,
  );
  const terminal = appState.terminals.get(terminalId);
  if (terminal) {
    terminal.runTitle = runCmd.title;
  }

  return {
    sessionId: terminalId,
    started: true,
    title: runCmd.title,
    dependencies,
  };
}

/** Look up an alive run-terminal session for this session + title. */
function findRunSession(
  sessionId: string,
  title: string,
): TerminalSession | null {
  for (const session of appState.terminals.values()) {
    if (
      session.sessionId === sessionId &&
      session.runTitle === title &&
      session.exitCode === null
    ) {
      return session;
    }
  }

  return null;
}

/**
 * List live terminals belonging to a session. Used by the renderer to
 * rehydrate tab state after a window reload — PTYs persist in main but the
 * Zustand store is renderer-local, so without this we'd "lose" tabs whose
 * processes are still very much running.
 *
 * Exited tombstones are excluded; callers care about resumable tabs.
 */
export function listTerminals(sessionId: string): TerminalSummary[] {
  const out: TerminalSummary[] = [];
  for (const t of appState.terminals.values()) {
    if (t.sessionId !== sessionId) {
      continue;
    }
    if (t.exitCode !== null) {
      continue;
    }
    out.push({
      id: t.id,
      sessionId: t.sessionId,
      title: t.title ?? null,
      runTitle: t.runTitle ?? null,
      exited: false,
      exitCode: null,
    });
  }

  return out;
}

/**
 * Update the renderer-facing title for an existing terminal so renames
 * survive a window reload.
 *
 * @throws A plain string if the terminal session is not found.
 */
export function updateTerminalTitle(terminalId: string, title: string): void {
  const session = appState.terminals.get(terminalId);
  if (!session) {
    throw `Terminal session not found: ${terminalId}`;
  }
  session.title = title;
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
  // The entry may be a tombstone for an exited PTY — resizing would crash.
  if (session.exitCode !== null) {
    return;
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

  // If the process already exited, the entry is just a captured-output
  // tombstone — drop it without re-emitting an exit event, since one was
  // already broadcast when the PTY actually exited.
  if (session.exitCode !== null) {
    appState.terminals.delete(sessionId);

    return;
  }

  try {
    session.pty.kill();
  } catch {
    // The process may have already exited; treat as non-fatal.
  }
  // Backstop: if the spawn-helper hasn't exec'd into the shell yet, the
  // PTY-master close above won't reach it and it will reparent to launchd.
  // Send SIGKILL directly to the captured pid so the helper exits too.
  try {
    process.kill(session.pid, "SIGKILL");
  } catch {
    // ESRCH: process already gone — expected in the common case.
  }

  appState.terminals.delete(sessionId);

  // Wake any pending waiters so they don't hang on a destroyed terminal.
  for (const w of session.waiters) {
    if (w.timer) {
      clearTimeout(w.timer);
    }
    w.resolve({
      reason: "exit",
      exitCode: -1,
      output: session.outputLog,
      totalBytes: session.outputTotalBytes,
      droppedBytes: session.outputDroppedBytes,
    });
  }
  session.waiters = [];

  // Notify the renderer that the session has ended.
  emitHostEvent(`terminal:exit:${sessionId}`, -1);
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
  if (session.exitCode !== null) {
    return;
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
 * Async variant of {@link destroyAllTerminals} that waits up to `timeoutMs`
 * for each PTY's `onExit` to fire after the kill, then SIGKILLs by pid as a
 * final backstop for any helpers still alive. Use this from `before-quit`
 * so we don't `app.quit()` before node-pty has a chance to reap children.
 */
export async function destroyAllTerminalsAndWait(
  timeoutMs = 1500,
): Promise<void> {
  const sessions = Array.from(appState.terminals.values());
  const pids = sessions.map((s) => s.pid);

  const exitPromises = sessions.map(
    (s) =>
      new Promise<void>((resolve) => {
        if (s.exitCode !== null) {
          resolve();

          return;
        }
        const sub = s.pty.onExit(() => {
          try {
            sub.dispose();
          } catch {
            // node-pty dispose is best-effort; ignore.
          }
          resolve();
        });
      }),
  );

  destroyAllTerminals();

  await Promise.race([
    Promise.all(exitPromises),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref?.()),
  ]);

  // Final backstop: SIGKILL anything that's still around by pid.
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ESRCH: process already gone — expected in the common case.
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
  if (session.exitCode !== null) {
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
  if (session.exitCode !== null) {
    return;
  }
  session.pty.resize(cols, rows);
}
