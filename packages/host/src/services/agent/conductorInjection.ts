/**
 * Match a `conductor` invocation as a command head: at the start of the line
 * or after a shell separator (`;`, `&&`, `||`, `|`, `` ` ``, `$(`), optionally
 * preceded by a runner like `npx`/`pnpm`/`yarn`/`bunx`. This deliberately
 * does not match the literal text "conductor" appearing inside a path like
 * `/Users/x/Projects/conductor`, which would otherwise trigger device
 * injection on unrelated commands (e.g. `git -C /…/conductor log`).
 */
const CONDUCTOR_COMMAND_RE =
  /((?:^|[;&|`(]|\$\()\s*)((?:(?:npx|pnpm|pnpx|yarn|bunx)\s+)?conductor)(\s+\S+)/;

/** True if `command` invokes the `conductor` CLI (vs. just mentioning it). */
export function isConductorInvocation(command: string): boolean {
  return CONDUCTOR_COMMAND_RE.test(command);
}

/**
 * Inject `--device {udid}` into a conductor CLI command string. Returns the
 * command unchanged if it already has `--device` or doesn't actually invoke
 * the conductor CLI.
 */
export function injectDeviceFlag(command: string, udid: string): string {
  if (command.includes("--device")) {
    return command;
  }

  return command.replace(CONDUCTOR_COMMAND_RE, `$1$2$3 --device ${udid}`);
}
