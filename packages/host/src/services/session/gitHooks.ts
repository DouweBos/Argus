/**
 * Phase 7 T8 — repository hooks surface.
 *
 * Lists `.git/hooks/*` (excluding `.sample`) and lets the user run them
 * manually. Each run captures stdout/stderr/exit and persists the result
 * under `.git/argus-hooks-log/<name>.json` so a refresh shows the last run.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { appState } from "../../state";
import { git } from "./git";
import { GitError } from "./gitError";

const execFileAsync = promisify(execFile);

function requireSession(id: string): { path: string } {
  const ws = appState.sessions.get(id);
  if (!ws) {
    throw new GitError("unknown", `Session not found: ${id}`);
  }

  return { path: ws.path };
}

export interface HookOutput {
  exitCode: number;
  ranAt: number;
  stderr: string;
  stdout: string;
}

export interface Hook {
  executable: boolean;
  lastModified: number;
  lastOutput: HookOutput | null;
  name: string;
  path: string;
}

async function gitDir(cwd: string): Promise<string> {
  const out = (await git(cwd, ["rev-parse", "--git-dir"])).trim();

  return path.isAbsolute(out) ? out : path.join(cwd, out);
}

async function readLastOutput(
  gitDirAbs: string,
  hookName: string,
): Promise<HookOutput | null> {
  const file = path.join(gitDirAbs, "argus-hooks-log", `${hookName}.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<HookOutput>;
    if (
      typeof parsed.stdout !== "string" ||
      typeof parsed.stderr !== "string" ||
      typeof parsed.exitCode !== "number" ||
      typeof parsed.ranAt !== "number"
    ) {
      return null;
    }

    return parsed as HookOutput;
  } catch {
    return null;
  }
}

async function writeLastOutput(
  gitDirAbs: string,
  hookName: string,
  output: HookOutput,
): Promise<void> {
  const dir = path.join(gitDirAbs, "argus-hooks-log");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${hookName}.json`),
    JSON.stringify(output, null, 2),
    "utf8",
  );
}

export async function gitListHooks(id: string): Promise<Hook[]> {
  const { path: cwd } = requireSession(id);
  const gitDirAbs = await gitDir(cwd);
  const hooksDir = path.join(gitDirAbs, "hooks");
  let names: string[];
  try {
    names = await fs.readdir(hooksDir);
  } catch {
    return [];
  }
  const hooks: Hook[] = [];
  for (const name of names) {
    if (name.endsWith(".sample")) {
      continue;
    }
    const full = path.join(hooksDir, name);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) {
      continue;
    }
    // `executable` is a portable approximation: any user-execute bit.
    const executable = (stat.mode & 0o111) !== 0;
    const lastOutput = await readLastOutput(gitDirAbs, name);
    hooks.push({
      name,
      path: full,
      executable,
      lastModified: stat.mtimeMs,
      lastOutput,
    });
  }
  hooks.sort((a, b) => a.name.localeCompare(b.name));

  return hooks;
}

export async function gitRunHook(
  id: string,
  opts: { name: string },
): Promise<HookOutput> {
  const { path: cwd } = requireSession(id);
  const gitDirAbs = await gitDir(cwd);
  const hookPath = path.join(gitDirAbs, "hooks", opts.name);
  let stat;
  try {
    stat = await fs.stat(hookPath);
  } catch {
    throw new GitError("unknown", `Hook not found: ${opts.name}`);
  }
  if (!stat.isFile()) {
    throw new GitError("unknown", `Hook is not a regular file: ${opts.name}`);
  }
  if ((stat.mode & 0o111) === 0) {
    throw new GitError(
      "unknown",
      `Hook is not executable: ${opts.name}. chmod +x to enable.`,
    );
  }
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    const r = await execFileAsync(hookPath, [], { cwd });
    stdout = r.stdout;
    stderr = r.stderr;
  } catch (err: unknown) {
    const e = err as {
      code?: number;
      stderr?: string;
      stdout?: string;
    };
    stdout = e.stdout ?? "";
    stderr = e.stderr ?? "";
    exitCode = typeof e.code === "number" ? e.code : 1;
  }
  const output: HookOutput = {
    stdout,
    stderr,
    exitCode,
    ranAt: Date.now(),
  };
  await writeLastOutput(gitDirAbs, opts.name, output);

  return output;
}
