/**
 * Platform-aware resolution of what to spawn inside a PTY.
 *
 * POSIX has `/bin/sh` and uses the user's `$SHELL` for interactive sessions and
 * `sh -c <command>` for one-shot commands. Windows has neither — node-pty there
 * drives a ConPTY, so we launch PowerShell interactively and run one-shot
 * commands through `cmd.exe /d /s /c` (the canonical "run this command line"
 * form, matching what Node's `child_process` uses with `shell: true`).
 *
 * Both functions take an explicit `platform` so each branch is unit-testable on
 * any host; callers pass nothing and get the current platform.
 *
 * NOTE: one-shot `command` strings (e.g. from `.argus.json` `run`/`setup`) are
 * authored as POSIX shell and won't parse under `cmd.exe`. Making those
 * portable (or running them in WSL) is a separate, out-of-scope concern — this
 * module only owns spawning a valid shell for the host.
 */

/** Interactive shell to launch when no one-shot command is given. */
export function defaultShell(
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") {
    return process.env.SHELL ?? "powershell.exe";
  }

  return process.env.SHELL ?? "/bin/sh";
}

/**
 * Resolve `[program, args]` to hand to `pty.spawn`. With a one-shot `command`,
 * run it through the platform shell; otherwise launch the interactive shell.
 */
export function resolveTerminalSpawn(
  command?: string,
  platform: NodeJS.Platform = process.platform,
): [string, string[]] {
  if (!command) {
    return [defaultShell(platform), []];
  }

  if (platform === "win32") {
    const comspec = process.env.COMSPEC ?? "cmd.exe";

    return [comspec, ["/d", "/s", "/c", command]];
  }

  return ["sh", ["-c", command]];
}
