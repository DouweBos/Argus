/**
 * Resolve the user's login-shell PATH and fix the process environment.
 *
 * In a packaged Electron `.app` bundle on macOS the process inherits a minimal
 * environment (`/usr/bin:/bin:/usr/sbin:/sbin`).  This module runs the user's
 * login shell once at startup to capture the full PATH, then sets it
 * process-wide so that all child spawns (PTY sessions, git commands, etc.) see
 * user-installed tools (Homebrew, mise, nvm, …).
 *
 * Call {@link fixProcessPath} once during app setup, before any PTY sessions
 * are created.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { warn } from "../../../app/lib/logger";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the login-shell PATH and apply it to the current process.
 *
 * Tries an interactive login shell (`-ilc`) first so that `~/.zshrc`
 * additions (Homebrew, mise, nvm, …) are picked up.  Falls back to a
 * login-only shell (`-lc`) if the interactive invocation fails or returns the
 * same PATH as the current process.
 *
 * No-ops if the resolved PATH is identical to the current one.
 */
export function fixProcessPath(): string[] {
  const diagnostics: string[] = [];
  const current = process.env.PATH ?? "";
  diagnostics.push(`SHELL=${process.env.SHELL ?? "(unset)"}`);
  diagnostics.push(`current PATH has ${current.split(":").length} entries`);

  const resolved = resolvePathFromLoginShell(current, diagnostics);
  if (resolved && resolved !== current) {
    diagnostics.push("PATH updated from login shell");
    process.env.PATH = resolved;
  } else {
    diagnostics.push(
      "login shell did not yield a new PATH, applying known fallback dirs",
    );
    // When the login shell approach fails (e.g. hardened runtime, missing
    // SHELL, slow init files), manually prepend well-known directories where
    // developer tools are commonly installed on macOS.
    const home = process.env.HOME ?? os.homedir();
    const fallbackDirs = [
      path.join(home, ".local", "bin"), // Claude Code CLI, pipx, etc.
      path.join(home, ".local", "share", "mise", "shims"), // mise
      "/opt/homebrew/bin", // Homebrew on Apple Silicon
      "/opt/homebrew/sbin",
      "/usr/local/bin", // Homebrew on Intel / manual installs
    ];

    const existingParts = new Set(current.split(":"));
    const additions = fallbackDirs.filter(
      (d) => !existingParts.has(d) && fs.existsSync(d),
    );

    if (additions.length > 0) {
      process.env.PATH = [...additions, current].join(":");
      diagnostics.push(`prepended fallback dirs: ${additions.join(", ")}`);
    } else {
      diagnostics.push("no new fallback dirs to add");
    }
  }

  return diagnostics;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Spawn the user's login shell to capture its PATH.
 *
 * Tries interactive login (`-ilc`) first; falls back to login-only (`-lc`).
 * Returns `undefined` if both attempts fail or produce no useful value.
 */
function resolvePathFromLoginShell(
  currentPath: string,
  diagnostics: string[],
): string | undefined {
  const shell = process.env.SHELL ?? "/bin/zsh";

  // Try interactive-login first — sources both .zprofile and .zshrc.
  const interactive = runShellForPath(
    shell,
    ["-ilc", `printf '%s' "$PATH"`],
    currentPath,
  );
  if (interactive) {
    diagnostics.push(
      `interactive login shell succeeded (${interactive.split(":").length} entries)`,
    );

    return interactive;
  }
  diagnostics.push("interactive login shell failed or returned same PATH");

  // Fallback: login-only — sources .zprofile but not .zshrc.
  const loginOnly = runShellForPath(
    shell,
    ["-lc", `printf '%s' "$PATH"`],
    currentPath,
  );
  if (loginOnly) {
    diagnostics.push(
      `login-only shell succeeded (${loginOnly.split(":").length} entries)`,
    );

    return loginOnly;
  }
  diagnostics.push("login-only shell also failed or returned same PATH");

  return undefined;
}

/**
 * Invoke `shell` with `args`, capture stdout, and return the trimmed string
 * only if it is non-empty and differs from `currentPath`.
 *
 * Returns `undefined` on any error or when the result would be a no-op.
 */
function runShellForPath(
  shell: string,
  args: string[],
  currentPath: string,
): string | undefined {
  try {
    const stdout = execFileSync(shell, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      // Give the shell a generous timeout; it may source slow init files.
      timeout: 10_000,
    });

    // Strip ANSI/OSC escape sequences (e.g. iTerm2 shell integration emits
    // OSC 1337 sequences during interactive shell startup that pollute stdout).
    // eslint-disable-next-line no-control-regex
    const oscPattern = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
    // eslint-disable-next-line no-control-regex
    const csiPattern = /\x1b\[[0-9;]*[a-zA-Z]/g;
    const cleaned = stdout
      .replace(oscPattern, "") // OSC sequences (e.g. iTerm2 shell integration)
      .replace(csiPattern, "") // CSI sequences (ANSI escape codes)
      .trim();

    const resolved = cleaned;
    if (!resolved || resolved === currentPath) {
      return undefined;
    }

    return resolved;
  } catch (err) {
    warn("[shellEnv] shell invocation failed:", shell, args, String(err));

    return undefined;
  }
}
