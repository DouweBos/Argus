/**
 * `.argus.json` `teardown.commands`: run in a worktree, with the session's
 * `workspace_env` set, right before the worktree is removed.
 */

import type { Session } from "./models";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { info } from "@argus/host/logger";
import { capture } from "../telemetry/telemetry";
import { loginShellEnv } from "../terminal/loginEnv";
import { defaultShell, terminalEnv } from "../terminal/multiplexer";
import { loadArgusConfig } from "./argusConfig";
import {
  clearSessionProgress,
  lastOutputLine,
  setSessionProgress,
} from "./progress";

/** Give up on a teardown command that has been silent this long (ms). */
const TEARDOWN_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/** Lines of a failed command's output kept in the error the user sees. */
const ERROR_TAIL_LINES = 20;

export interface TeardownStep {
  /** 1-based index of the running command. */
  current: number;
  total: number;
  command: string;
  /** The command's latest output line. */
  detail: string | null;
}

/** The same bash setup commands run in: no rc files, the login env applied. */
function teardownShell(): string {
  return fs.existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh";
}

/** Keep the last `n` non-empty lines of `output`. */
export function outputTail(output: string, n = ERROR_TAIL_LINES): string {
  return output
    .split(/[\r\n]+/)
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .slice(-n)
    .join("\n");
}

/** Run one command; resolves with its exit code and output. */
export function runTeardownCommand(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  onOutput: (chunk: string) => void,
  idleTimeoutMs = TEARDOWN_IDLE_TIMEOUT_MS,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(teardownShell(), ["-c", command], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let lastOutputAt = Date.now();
    const onData = (data: Buffer) => {
      const text = data.toString();
      lastOutputAt = Date.now();
      output = (output + text).slice(-64 * 1024);
      onOutput(text);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const idle = setInterval(() => {
      if (Date.now() - lastOutputAt > idleTimeoutMs) {
        output += `\nNo output for ${Math.round(idleTimeoutMs / 60000)} minutes, stopped.`;
        child.kill("SIGKILL");
      }
    }, 1000);
    child.on("error", (e) => {
      clearInterval(idle);
      resolve({ code: 127, output: `${output}\n${e.message}` });
    });
    child.on("close", (code, signal) => {
      clearInterval(idle);
      resolve({ code: code ?? (signal ? 128 : 1), output });
    });
  });
}

/**
 * Run `commands` in the session's worktree, in order, stopping at the first
 * failure. Throws a string naming the command with the tail of its output.
 */
export async function runTeardown(
  session: Session,
  commands: string[],
  onStep: (step: TeardownStep) => void,
): Promise<void> {
  const base = terminalEnv(session);
  const login = await loginShellEnv(defaultShell(), base, session.path);
  const env = login ? { ...base, ...login } : base;

  for (const [i, command] of commands.entries()) {
    const step = { current: i + 1, total: commands.length, command };
    info(`Teardown [${step.current}/${step.total}] ${command}`);
    onStep({ ...step, detail: null });
    const { code, output } = await runTeardownCommand(
      command,
      session.path,
      env,
      (chunk) => {
        const detail = lastOutputLine(chunk);
        if (detail) {
          onStep({ ...step, detail });
        }
      },
    );
    if (code !== 0) {
      const tail = outputTail(output);
      throw `Teardown command failed (exit ${code}): ${command}${tail ? `\n${tail}` : ""}`;
    }
  }
}

/** Coarse duration for telemetry. */
export function teardownDurationBucket(
  ms: number,
): "<1m" | "<10m" | "<10s" | ">=10m" {
  if (ms < 10_000) {
    return "<10s";
  }
  if (ms < 60_000) {
    return "<1m";
  }

  return ms < 600_000 ? "<10m" : ">=10m";
}

/** Run the project's teardown commands, reporting each as delete progress. */
export async function teardownSession(session: Session): Promise<void> {
  let commands: string[];
  try {
    commands = loadArgusConfig(session.path).teardown?.commands ?? [];
  } catch (e) {
    throw `Couldn't read the project config for teardown: ${e}`;
  }
  if (commands.length === 0 || !fs.existsSync(session.path)) {
    return;
  }
  const started = Date.now();
  let success = false;
  try {
    await runTeardown(session, commands, (step) =>
      setSessionProgress(session.id, {
        current: step.current - 1,
        total: step.total,
        phase: "teardown",
        detail: step.detail ?? step.command,
      }),
    );
    success = true;
  } finally {
    clearSessionProgress(session.id);
    capture("session_teardown_ran", {
      command_count: commands.length,
      success,
      duration_bucket: teardownDurationBucket(Date.now() - started),
    });
  }
}
