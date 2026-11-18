/** `gh` and `git` for blueprints, with the errors turned into something to act on. */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface ExecError {
  code?: number | string;
  stderr?: string;
  message?: string;
}

function describe(tool: string, err: unknown): string {
  const e = err as ExecError;
  if (e?.code === "ENOENT") {
    return tool === "gh"
      ? "gh CLI is not installed. Install it from https://cli.github.com and run `gh auth login`."
      : `${tool} is not installed.`;
  }
  const stderr = typeof e?.stderr === "string" ? e.stderr.trim() : "";
  const text =
    stderr || (typeof e?.message === "string" ? e.message : String(err));
  if (
    tool === "gh" &&
    /not logged in|authentication|auth login|401/i.test(text)
  ) {
    return "Not authenticated with GitHub. Run `gh auth login` to sign in.";
  }

  return text;
}

/** Run `gh`, resolving with trimmed stdout or throwing a readable string. */
export async function runGh(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("gh", args, {
      cwd,
      maxBuffer: 4 * 1024 * 1024,
    });

    return stdout.trim();
  } catch (err) {
    throw describe("gh", err);
  }
}

export async function runGit(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 4 * 1024 * 1024,
    });

    return stdout.trim();
  } catch (err) {
    throw describe("git", err);
  }
}
