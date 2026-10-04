/**
 * The host half of a remote `GitRunner` (GroveKit): spawn git for a session and
 * hand stdout back as bytes. Admin-only, so it is shell access by design — the
 * cwd check keeps well-behaved clients inside the session, it is not a jail.
 *
 * Errors are thrown as plain strings to match IPC error handling.
 */

import { type ChildProcess, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { emitHostEvent } from "@argus/host/bus";
import { appState } from "../../state";
import { resolveContainedPath } from "../file/operations";
import {
  currentConnectionId,
  onConnectionClose,
} from "../remote/connectionScope";
import { git } from "../session/git";
import {
  classifyGitStderr,
  type GitErrorKind,
  type GitRecovery,
  isGitRecovery,
} from "../session/gitError";

export interface GitRunnerInfo {
  commonGitDir: string;
  gitDir: string;
  scratchDir: string;
  worktree: string;
}

export interface GitRunnerFailure {
  kind: GitErrorKind;
  message: string;
  recovery?: GitRecovery;
}

export interface GitRunnerRunResult {
  exitCode: number;
  failure?: GitRunnerFailure;
  outputId?: string;
  stderr: string;
  stdout: string;
  stdoutBytes: number;
}

export interface GitRunnerOutputChunk {
  data: string;
  done: boolean;
}

export interface GitRunnerRunParams {
  sessionId: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  runId?: string;
}

/** Above this stdout is paged, keeping each base64 frame well under 16 MB. */
export const INLINE_LIMIT = 4 * 1024 * 1024;
const PAGE_SIZE = INLINE_LIMIT;
/** Held output expires this long after it was last read. */
const OUTPUT_TTL_MS = 60_000;
/** A runaway command (e.g. `cat-file` of a huge blob) is killed past this. */
const MAX_STDOUT = 512 * 1024 * 1024;
const MAX_STDERR = 1024 * 1024;
/** Scratch files a client left behind (it crashed, the host restarted). */
const SCRATCH_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** After SIGTERM, a group that is still there gets SIGKILL. */
const KILL_GRACE_MS = 3000;

const running = new Map<string, ChildProcess>();
/** Connections using each scratch dir; the last one out clears it. */
const scratchHolders = new Map<string, Set<string>>();
const held = new Map<
  string,
  { data: Buffer; timer: ReturnType<typeof setTimeout> }
>();

export const progressChannel = (runId: string) =>
  `git-runner:progress:${runId}`;

function sessionWorktree(sessionId: string): string {
  const session = appState.sessions.get(sessionId);
  if (!session) {
    throw `Session not found: ${sessionId}`;
  }

  return session.path;
}

export async function gitRunnerInfo(sessionId: string): Promise<GitRunnerInfo> {
  const worktree = await fs.promises.realpath(sessionWorktree(sessionId));
  const [gitDirOut, commonOut] = await Promise.all([
    git(worktree, ["rev-parse", "--absolute-git-dir"]),
    git(worktree, ["rev-parse", "--git-common-dir"]),
  ]);
  const gitDir = await fs.promises.realpath(gitDirOut.trim());
  const commonGitDir = await fs.promises.realpath(
    path.resolve(worktree, commonOut.trim()),
  );
  const scratchDir = path.join(gitDir, "argus-scratch");
  await fs.promises.mkdir(scratchDir, { recursive: true });
  await sweepStaleScratch(scratchDir);
  holdScratch(scratchDir);

  return { worktree, gitDir, commonGitDir, scratchDir };
}

async function sweepStaleScratch(scratchDir: string): Promise<void> {
  const cutoff = Date.now() - SCRATCH_MAX_AGE_MS;
  for (const name of await fs.promises.readdir(scratchDir).catch(() => [])) {
    const entry = path.join(scratchDir, name);
    const stat = await fs.promises.lstat(entry).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) {
      await fs.promises.rm(entry, { recursive: true, force: true });
    }
  }
}

/** Remember who works in `scratchDir`, so it goes once they all have. */
function holdScratch(scratchDir: string): void {
  const connectionId = currentConnectionId();
  if (!connectionId) {
    return;
  }
  let holders = scratchHolders.get(scratchDir);
  if (!holders) {
    holders = new Set();
    scratchHolders.set(scratchDir, holders);
  }
  if (holders.has(connectionId)) {
    return;
  }
  holders.add(connectionId);
  const set = holders;
  onConnectionClose(() => {
    set.delete(connectionId);
    if (set.size > 0 || scratchHolders.get(scratchDir) !== set) {
      return;
    }
    scratchHolders.delete(scratchDir);
    fs.promises
      .rm(scratchDir, { recursive: true, force: true })
      .catch(() => undefined);
  });
}

export async function gitRunnerRun(
  p: GitRunnerRunParams,
): Promise<GitRunnerRunResult> {
  const worktree = sessionWorktree(p.sessionId);
  if (p.cwd !== undefined && !path.isAbsolute(p.cwd)) {
    throw `cwd must be absolute: ${p.cwd}`;
  }
  const cwd = await resolveContainedPath(p.sessionId, p.cwd ?? worktree, {
    mustExist: true,
  });
  const runId = p.runId;
  if (runId !== undefined && running.has(runId)) {
    throw `Run already in progress: ${runId}`;
  }

  const child = spawn("git", p.args, {
    cwd,
    env: {
      ...process.env,
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      GIT_PAGER: "cat",
      PAGER: "cat",
      GIT_TERMINAL_PROMPT: "0",
      ...p.env,
    },
    stdio: ["pipe", "pipe", "pipe"],
    // Its own process group, so cancel also reaches hooks, aliases and ssh.
    detached: true,
  });
  if (runId !== undefined) {
    running.set(runId, child);
  }
  // A client that dropped can't cancel, and nobody else knows the run exists.
  const releaseOnClose = onConnectionClose(() => terminate(child));

  const stdout: Buffer[] = [];
  let stdoutBytes = 0;
  let overflowed = false;
  let stderr = "";
  const decoder = new StringDecoder("utf8");

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > MAX_STDOUT) {
      overflowed = true;
      killGroup(child, "SIGKILL");

      return;
    }
    stdout.push(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const text = decoder.write(chunk);
    if (!text) {
      return;
    }
    if (stderr.length < MAX_STDERR) {
      stderr += text.slice(0, MAX_STDERR - stderr.length);
    }
    if (runId !== undefined) {
      emitHostEvent(progressChannel(runId), { chunk: text });
    }
  });
  // git may exit without reading its input; that is its answer, not ours.
  child.stdin.on("error", () => undefined);
  child.stdin.end(p.stdin ? Buffer.from(p.stdin, "base64") : undefined);

  let exitCode: number;
  try {
    exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => {
        resolve(code ?? (signal ? 128 + os.constants.signals[signal] : -1));
      });
    });
  } catch (e) {
    throw `Failed to run git: ${String(e)}`;
  } finally {
    releaseOnClose();
    if (runId !== undefined) {
      running.delete(runId);
    }
  }
  if (overflowed) {
    throw `git output exceeded ${String(MAX_STDOUT / 1024 / 1024)} MB`;
  }
  const tail = decoder.end();
  if (tail && stderr.length < MAX_STDERR) {
    stderr += tail;
  }

  const failure = exitCode === 0 ? undefined : classifyFailure(p.args, stderr);
  const data = Buffer.concat(stdout);
  if (data.length <= INLINE_LIMIT) {
    return {
      exitCode,
      stdout: data.toString("base64"),
      stderr,
      stdoutBytes,
      ...(failure && { failure }),
    };
  }
  const outputId = crypto.randomUUID();
  hold(outputId, data);

  return {
    exitCode,
    stdout: "",
    stderr,
    stdoutBytes,
    outputId,
    ...(failure && { failure }),
  };
}

/** The subcommand is the hint: a conflict means something else mid-rebase. */
export function classifyFailure(
  args: string[],
  stderr: string,
): GitRunnerFailure {
  const op = args.find(
    (a, i) => !a.startsWith("-") && !["-c", "-C"].includes(args[i - 1] ?? ""),
  );
  const err = classifyGitStderr(stderr, { op });

  return {
    kind: err.kind,
    message: err.message,
    ...(isGitRecovery(err.recovery) && { recovery: err.recovery }),
  };
}

function hold(outputId: string, data: Buffer): void {
  const existing = held.get(outputId);
  if (existing) {
    clearTimeout(existing.timer);
  }
  const timer = setTimeout(() => held.delete(outputId), OUTPUT_TTL_MS);
  timer.unref();
  held.set(outputId, { data, timer });
}

export function gitRunnerOutput(
  outputId: string,
  offset: number,
): GitRunnerOutputChunk {
  const entry = held.get(outputId);
  if (!entry) {
    throw `Output expired or unknown: ${outputId}`;
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > entry.data.length) {
    throw `Offset out of range: ${String(offset)}`;
  }
  const end = Math.min(offset + PAGE_SIZE, entry.data.length);
  const done = end >= entry.data.length;
  if (done) {
    clearTimeout(entry.timer);
    held.delete(outputId);
  } else {
    hold(outputId, entry.data);
  }

  return { data: entry.data.subarray(offset, end).toString("base64"), done };
}

/** Unknown or finished runs are a no-op: the cancel raced the exit. */
export function gitRunnerCancel(runId: string): void {
  const child = running.get(runId);
  if (child) {
    killGroup(child, "SIGTERM");
  }
}

function terminate(child: ChildProcess): void {
  killGroup(child, "SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      killGroup(child, "SIGKILL");
    }
  }, KILL_GRACE_MS).unref();
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (child.pid !== undefined) {
      process.kill(-child.pid, signal);

      return;
    }
  } catch {
    // The group is already gone; fall through to the child itself.
  }
  child.kill(signal);
}
