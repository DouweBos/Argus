/**
 * The environment a user's interactive login shell builds, resolved off any
 * terminal so its rc files can't prompt or read what is typed into one.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MARKER = "__ARGUS_LOGIN_ENV__";
const LOGIN_SHELLS = new Set(["bash", "fish", "ksh", "zsh"]);

/** The shell's own bookkeeping and the terminal's — never carried over. */
const SKIP = new Set([
  "_",
  "COLUMNS",
  "EUID",
  "LINES",
  "OLDPWD",
  "PPID",
  "PS1",
  "PS2",
  "PS4",
  "PWD",
  "SHELLOPTS",
  "SHLVL",
  "TERM",
  "UID",
]);

/**
 * Run `shell` as an interactive login shell in `cwd` and return the env it
 * exports. Detached, so it has no controlling terminal, with stdin closed and
 * stdout a pipe: rc prompts (oh-my-zsh's update check, compinit) skip or fail
 * instead of waiting on a key. Null for a shell we can't start as a login
 * shell, a failure, or one slower than `timeoutMs`.
 */
export function loginShellEnv(
  shell: string,
  env: Record<string, string>,
  cwd: string,
  timeoutMs = 15_000,
): Promise<Record<string, string> | null> {
  if (!LOGIN_SHELLS.has(path.basename(shell))) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const child = spawn(
      shell,
      ["-ilc", `printf '%s\\n' ${MARKER}; exec env -0`],
      { cwd, env, detached: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      try {
        process.kill(-(child.pid ?? 0), "SIGKILL");
      } catch {
        // Already gone.
      }
      resolve(null);
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(
        code === 0 ? parseLoginEnv(Buffer.concat(chunks).toString()) : null,
      );
    });
  });
}

/** `env -0` output after the marker; anything an rc printed before is noise. */
export function parseLoginEnv(output: string): Record<string, string> | null {
  const at = output.indexOf(`${MARKER}\n`);
  if (at < 0) {
    return null;
  }
  const env: Record<string, string> = {};
  for (const entry of output.slice(at + MARKER.length + 1).split("\0")) {
    const eq = entry.indexOf("=");
    if (eq > 0) {
      env[entry.slice(0, eq)] = entry.slice(eq + 1);
    }
  }

  return env;
}

/** A POSIX script exporting `env`, for a shell to source. */
export function exportScript(env: Record<string, string>): string {
  return Object.entries(env)
    .filter(
      ([name]) =>
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
        !SKIP.has(name) &&
        !name.startsWith("BASH"),
    )
    .map(([name, value]) => `export ${name}='${value.replace(/'/g, "'\\''")}'`)
    .join("\n");
}

/** Write `exportScript(env)` to a private temp file; the caller removes it. */
export function writeExportScript(env: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "argus-env-"));
  const file = path.join(dir, "env.sh");
  fs.writeFileSync(file, `${exportScript(env)}\n`, { mode: 0o600 });

  return file;
}
