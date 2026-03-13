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
export function fixProcessPath(): void {
  const current = process.env.PATH ?? "";

  const resolved = resolvePathFromLoginShell(current);
  if (!resolved) {
    return;
  }

  if (resolved !== current) {
    process.env.PATH = resolved;
  }
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
): string | undefined {
  const shell = process.env.SHELL ?? "/bin/zsh";

  // Try interactive-login first — sources both .zprofile and .zshrc.
  const interactive = runShellForPath(
    shell,
    ["-ilc", `printf '%s' "$PATH"`],
    currentPath,
  );
  if (interactive) {
    return interactive;
  }

  // Fallback: login-only — sources .zprofile but not .zshrc.
  const loginOnly = runShellForPath(
    shell,
    ["-lc", `printf '%s' "$PATH"`],
    currentPath,
  );
  return loginOnly;
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

    const resolved = stdout.trim();
    if (!resolved || resolved === currentPath) {
      return undefined;
    }

    return resolved;
  } catch {
    return undefined;
  }
}
