/**
 * Asks a runner's CLI whether it's signed in: a status subcommand run with no
 * stdin and a short timeout, its output read by the runner's own parser.
 */

import type { RunnerAuthProbe } from "./types";
import { execFile } from "node:child_process";
import { stripAnsi } from "../../terminal/multiplexer";

export interface AuthProbeSpec {
  /** Arguments of the CLI's status subcommand, e.g. `["login", "status"]`. */
  args: string[];
  /** Reads stdout and stderr (joined, colour codes stripped) and the exit code. */
  parse: (output: string, exitCode: number) => RunnerAuthProbe;
}

const TIMEOUT_MS = 15_000;
const UNKNOWN: RunnerAuthProbe = { signedIn: null, account: null };

export function runAuthProbe(
  binPath: string,
  spec: AuthProbeSpec,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RunnerAuthProbe> {
  return new Promise((resolve) => {
    const child = execFile(
      binPath,
      spec.args,
      {
        timeout: TIMEOUT_MS,
        // A status check must never open a browser or wait on a prompt.
        env: { ...env, NO_COLOR: "1", NO_OPEN_BROWSER: "1", CI: "1" },
      },
      (error, stdout, stderr) => {
        if (error && (error.killed || typeof error.code !== "number")) {
          resolve(UNKNOWN);

          return;
        }
        const exitCode = typeof error?.code === "number" ? error.code : 0;
        try {
          resolve(spec.parse(stripAnsi(`${stdout}\n${stderr}`), exitCode));
        } catch {
          resolve(UNKNOWN);
        }
      },
    );
    child.stdin?.end();
  });
}
