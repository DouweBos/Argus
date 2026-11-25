/**
 * The one place a repository is cloned: Clone Repository, onboarding's
 * examples and blueprints all go through here.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import {
  type CloneProgress,
  CloneProgressReader,
  cloneFailureMessage,
} from "./progress";

/** Thrown (as the rejection) when the clone was cancelled. */
export const CLONE_CANCELLED = "Clone cancelled.";

export interface RunCloneOptions {
  /** Usually from `cloneCommand`. */
  program: string;
  args: string[];
  /** Where the clone lands; removed again on failure or cancel. */
  dest: string;
  cwd?: string;
  signal?: AbortSignal;
  onProgress?: (p: CloneProgress) => void;
}

function missingTool(program: string): string {
  return program === "gh"
    ? "gh CLI is not installed. Install it from https://cli.github.com and run `gh auth login`."
    : `${program} is not installed.`;
}

/**
 * Run the clone. Resolves when it finished; rejects with a readable string,
 * or `CLONE_CANCELLED`, after removing whatever it left at `dest`.
 */
export function runClone(opts: RunCloneOptions): Promise<void> {
  if (fs.existsSync(opts.dest)) {
    return Promise.reject(`${opts.dest} already exists.`);
  }

  return new Promise((resolve, reject) => {
    const reader = new CloneProgressReader((p) => opts.onProgress?.(p));
    // Its own process group, so cancelling also stops the git that `gh` starts.
    const child = spawn(opts.program, opts.args, {
      cwd: opts.cwd,
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let cancelled = false;
    let spawnError: string | null = null;

    let escalate: NodeJS.Timeout | null = null;
    const signalGroup = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid) {
          process.kill(-child.pid, signal);
        }
      } catch {
        child.kill(signal);
      }
    };
    const cancel = (): void => {
      cancelled = true;
      signalGroup("SIGTERM");
      // A git stuck on the network can sit out a TERM.
      escalate = setTimeout(() => signalGroup("SIGKILL"), 3000);
      escalate.unref();
    };
    if (opts.signal?.aborted) {
      cancel();
    } else {
      opts.signal?.addEventListener("abort", cancel, { once: true });
    }

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => reader.push(chunk));
    let settled = false;
    const finish = (code: number | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (escalate) {
        clearTimeout(escalate);
      }
      opts.signal?.removeEventListener("abort", cancel);
      reader.end();
      if (code === 0 && !cancelled && !spawnError) {
        resolve();

        return;
      }
      fs.rmSync(opts.dest, { recursive: true, force: true });
      if (cancelled) {
        reject(CLONE_CANCELLED);
      } else {
        reject(spawnError ?? cloneFailureMessage(reader.messages));
      }
    };
    child.on("error", (err: NodeJS.ErrnoException) => {
      spawnError =
        err.code === "ENOENT" ? missingTool(opts.program) : err.message;
      // A process that never started has no "close" to wait for.
      if (!child.pid) {
        finish(null);
      }
    });
    child.on("close", finish);
  });
}
