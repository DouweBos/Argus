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

import fs from "node:fs";
import path from "node:path";

import type { IPty } from "node-pty";
// node-pty is a native module; CJS require avoids ESM interop issues with
// native addons and matches how VSCode loads it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pty = require("node-pty") as typeof import("node-pty");

import { appState } from "../../state";
import { getMainWindow } from "../../main";
import { loadStagehandConfig } from "../workspace/setup";
import type { WorkspaceEnvConfig } from "../workspace/models";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single active PTY session. */
export interface TerminalSession {
  /** Unique identifier; also appears in event channel names. */
  id: string;
  /** The underlying node-pty instance. */
  pty: IPty;
  /** UUID of the workspace this session belongs to. */
  workspaceId: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return the user's preferred shell, falling back to `/bin/sh`.
 *
 * Mirrors `default_shell()` in `multiplexer.rs`.
 */
export function defaultShell(): string {
  return process.env.SHELL ?? "/bin/sh";
}

/**
 * Compute a deterministic per-workspace integer from `workspaceId` using a
 * simple djb2-style hash, bounded by `range`.
 *
 * Mirrors `workspace_env_value()` / `WorkspaceEnvStrategy::Hash` in
 * `terminal_cmds.rs`.
 */
export function workspaceEnvValue(
  workspaceId: string,
  envIndex: number | undefined,
  config: WorkspaceEnvConfig,
): number {
  const strategy = config.strategy ?? "hash";
  const baseValue = config.base_value ?? 8081;
  const range = config.range && config.range !== 0 ? config.range : 1000;

  if (strategy === "sequential") {
    return baseValue + (envIndex ?? 0);
  }

  // Hash strategy: djb2 over the UTF-8 bytes of workspaceId, mod range.
  let hash = 5381;
  for (let i = 0; i < workspaceId.length; i++) {
    // Equivalent to: hash = ((hash << 5) + hash) + charCode
    hash = Math.imul(hash, 33) ^ workspaceId.charCodeAt(i);
  }
  // Ensure non-negative before modulo.
  const offset = Math.abs(hash) % range;
  return baseValue + offset;
}

/**
 * Build any extra environment variables that should be injected into a
 * workspace terminal.
 *
 * Mirrors `build_workspace_env()` in `terminal_cmds.rs`.
 */
function buildWorkspaceEnv(
  workspaceId: string,
  workspaceKind: "repo_root" | "worktree",
  envIndex: number | undefined,
  repoRoot: string,
): Record<string, string> {
  const extra: Record<string, string> = {};

  // workspace_env only applies to worktree workspaces, not the repo root.
  if (workspaceKind === "repo_root") {
    return extra;
  }

  try {
    const config = loadStagehandConfig(repoRoot);
    for (const we of config.workspace_env) {
      if (we.name) {
        const value = workspaceEnvValue(workspaceId, envIndex, we);
        extra[we.name] = String(value);
      }
    }
  } catch {
    // Missing or unparseable .stagehand.json is non-fatal.
  }

  return extra;
}

// ---------------------------------------------------------------------------
// IPC-facing functions
// ---------------------------------------------------------------------------

/**
 * Spawn a PTY running the workspace's shell (or a one-shot command), register
 * data and exit event handlers, and store the session in {@link appState}.
 *
 * The PTY is spawned at 80×24; call {@link startTerminal} once xterm.js has
 * measured its container to resize it to the real dimensions.
 *
 * @param workspaceId - UUID of the owning workspace.
 * @param subDir      - Optional subdirectory (relative to the workspace root)
 *                      to use as the working directory.
 * @param command     - Optional one-shot command; if omitted, the user's login
 *                      shell is spawned interactively.
 * @returns The new session ID.
 * @throws A plain string if the workspace is not found or the PTY fails to
 *         spawn.
 */
export function createTerminal(
  workspaceId: string,
  subDir?: string,
  command?: string,
): string {
  const ws = appState.workspaces.get(workspaceId);
  if (!ws) {
    throw `Workspace not found: ${workspaceId}`;
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

  // Build workspace-specific environment extras.
  const extraEnv = buildWorkspaceEnv(
    workspaceId,
    ws.kind,
    ws.env_index ?? undefined,
    ws.repo_root,
  );

  // Determine the program and arguments.
  const [program, args]: [string, string[]] = command
    ? ["sh", ["-c", command]]
    : [defaultShell(), []];

  const sessionId = crypto.randomUUID();

  // node-pty requires all env values to be defined strings — filter out any
  // undefined entries from process.env to avoid posix_spawnp failures.
  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) cleanEnv[k] = v;
  }
  Object.assign(cleanEnv, extraEnv);

  const ptyProcess: IPty = pty.spawn(program, args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd,
    env: cleanEnv,
  });

  // Forward PTY output to the renderer as base64-encoded chunks.
  ptyProcess.onData((data: string) => {
    getMainWindow()?.webContents.send(
      `terminal:data:${sessionId}`,
      Buffer.from(data).toString("base64"),
    );
  });

  // Forward exit notification to the renderer.
  ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
    getMainWindow()?.webContents.send(`terminal:exit:${sessionId}`, exitCode);
    // Clean up state when the process exits on its own.
    appState.terminals.delete(sessionId);
  });

  const session: TerminalSession = {
    id: sessionId,
    pty: ptyProcess,
    workspaceId,
  };

  appState.terminals.set(sessionId, session);

  return sessionId;
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
  const raw = Buffer.from(data, "base64");
  session.pty.write(raw.toString());
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
