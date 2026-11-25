/**
 * An automation's precheck: a shell command that decides whether a run is
 * worth starting. Exit 0 lets the run go on; anything else, or no answer in
 * time, records the run as skipped with the command's last words.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";

export const DEFAULT_PRECHECK_TIMEOUT_SECONDS = 60;
export const MAX_PRECHECK_TIMEOUT_SECONDS = 30 * 60;

/** Lines of output kept in a skipped run's reason. */
const REASON_TAIL_LINES = 5;
const REASON_MAX_CHARS = 600;

export type PrecheckOutcome = "failed" | "passed" | "timed_out";

export interface PrecheckResult {
  outcome: PrecheckOutcome;
  /** Why the run is skipped; null when it passed. */
  reason: string | null;
}

/** A sane timeout from whatever was stored or sent. */
export function normalizePrecheckTimeout(seconds: unknown): number {
  if (
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return DEFAULT_PRECHECK_TIMEOUT_SECONDS;
  }

  return Math.min(Math.round(seconds), MAX_PRECHECK_TIMEOUT_SECONDS) || 1;
}

function tail(output: string): string {
  return output
    .split(/[\r\n]+/)
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .slice(-REASON_TAIL_LINES)
    .join("\n")
    .slice(-REASON_MAX_CHARS);
}

/**
 * Run `command` in `cwd` with a hard timeout. The child gets its own process
 * group so a timeout takes down whatever it spawned, not just the shell.
 */
export function runPrecheck(
  command: string,
  cwd: string,
  timeoutSeconds: number,
): Promise<PrecheckResult> {
  const shell = fs.existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh";

  return new Promise((resolve) => {
    const child = spawn(shell, ["-c", command], {
      cwd,
      env: process.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    const onData = (data: Buffer) => {
      output = (output + data.toString()).slice(-16 * 1024);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) {
          process.kill(-child.pid, "SIGKILL");
        }
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutSeconds * 1000);

    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({
        outcome: "failed",
        reason: `Skipped — the precheck could not start: ${e.message}`,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const last = tail(output);
      if (timedOut) {
        resolve({
          outcome: "timed_out",
          reason: `Skipped — the precheck did not finish within ${timeoutSeconds}s.${last ? `\n${last}` : ""}`,
        });
      } else if (code === 0) {
        resolve({ outcome: "passed", reason: null });
      } else {
        resolve({
          outcome: "failed",
          reason: `Skipped — the precheck exited with code ${code ?? 1}.${last ? `\n${last}` : ""}`,
        });
      }
    });
  });
}
