/** Argument parsing for the `argus` CLI. Pure, so every form is unit-tested. */

export type PermissionMode =
  | "acceptEdits"
  | "auto"
  | "bypassPermissions"
  | "default"
  | "plan";

const PERMISSION_MODES: PermissionMode[] = [
  "default",
  "auto",
  "acceptEdits",
  "bypassPermissions",
  "plan",
];

interface Output {
  json: boolean;
}

interface Waiting {
  wait: boolean;
  /** Seconds; null waits for as long as it takes. */
  timeout: number | null;
}

export type CliCommand =
  | { kind: "help" }
  | { kind: "version" }
  | (Output &
      Waiting & {
        kind: "new";
        dir: string;
        prompt: string;
        /** Null runs in the project's own checkout; "HEAD" forks the current branch. */
        worktree: string | null;
        name: string | null;
        model: string | null;
        mode: PermissionMode | null;
      })
  | (Output & { kind: "list"; dir: string })
  | (Output & { kind: "show"; agentId: string })
  | (Output & { kind: "stop"; agentId: string })
  | (Output & Waiting & { kind: "send"; agentId: string; message: string })
  | (Output & Waiting & { kind: "wait"; agentId: string });

export class UsageError extends Error {}

/** `-` as a prompt or message means "read it from stdin". */
export const STDIN = "-";

const VALUE_FLAGS = new Set([
  "--worktree",
  "--name",
  "--model",
  "--mode",
  "--timeout",
]);
const BOOL_FLAGS = new Set(["--wait", "--json", "--help", "-h"]);

interface Split {
  positional: string[];
  flags: Map<string, string | true>;
}

function split(argv: string[]): Split {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg === STDIN || !arg.startsWith("-")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg : arg.slice(0, eq);
    if (VALUE_FLAGS.has(name)) {
      const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (value === undefined || value === "") {
        throw new UsageError(`${name} needs a value`);
      }
      flags.set(name, value);
    } else if (BOOL_FLAGS.has(name) && eq === -1) {
      flags.set(name, true);
    } else {
      throw new UsageError(`unknown option ${arg}`);
    }
  }

  return { positional, flags };
}

function only(flags: Map<string, string | true>, allowed: string[]): void {
  for (const name of flags.keys()) {
    if (!allowed.includes(name)) {
      throw new UsageError(`${name} doesn't apply here`);
    }
  }
}

function str(flags: Map<string, string | true>, name: string): string | null {
  const v = flags.get(name);

  return typeof v === "string" ? v : null;
}

function waiting(flags: Map<string, string | true>, always = false): Waiting {
  const raw = str(flags, "--timeout");
  let timeout: number | null = null;
  if (raw !== null) {
    timeout = Number(raw);
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new UsageError("--timeout takes a number of seconds");
    }
  }

  return { wait: always || flags.has("--wait"), timeout };
}

function need(positional: string[], count: number, usage: string): void {
  if (positional.length !== count) {
    throw new UsageError(`usage: ${usage}`);
  }
}

export function parseArgs(argv: string[]): CliCommand {
  const [head, ...rest] = argv;
  if (!head || head === "help" || head === "--help" || head === "-h") {
    return { kind: "help" };
  }
  if (head === "--version" || head === "version") {
    return { kind: "version" };
  }
  const { positional, flags } = split(
    head === "session" ? rest.slice(1) : rest,
  );
  if (flags.has("--help") || flags.has("-h")) {
    return { kind: "help" };
  }
  const json = flags.has("--json");

  switch (head) {
    case "session": {
      if (rest[0] !== "new") {
        throw new UsageError("usage: argus session new <dir> <prompt|->");
      }
      only(flags, [
        "--worktree",
        "--name",
        "--model",
        "--mode",
        "--wait",
        "--timeout",
        "--json",
      ]);
      need(positional, 2, "argus session new <dir> <prompt|->");
      const mode = str(flags, "--mode");
      if (mode !== null && !PERMISSION_MODES.includes(mode as PermissionMode)) {
        throw new UsageError(`--mode is one of ${PERMISSION_MODES.join(", ")}`);
      }

      return {
        kind: "new",
        dir: positional[0],
        prompt: positional[1],
        worktree: str(flags, "--worktree"),
        name: str(flags, "--name"),
        model: str(flags, "--model"),
        mode: mode as PermissionMode | null,
        json,
        ...waiting(flags),
      };
    }
    case "send":
      only(flags, ["--wait", "--timeout", "--json"]);
      need(positional, 2, "argus send <agent-id> <message|->");

      return {
        kind: "send",
        agentId: positional[0],
        message: positional[1],
        json,
        ...waiting(flags),
      };
    case "wait":
      only(flags, ["--timeout", "--json"]);
      need(positional, 1, "argus wait <agent-id>");

      return {
        kind: "wait",
        agentId: positional[0],
        json,
        ...waiting(flags, true),
      };
    case "show":
    case "stop":
      only(flags, ["--json"]);
      need(positional, 1, `argus ${head} <agent-id>`);

      return { kind: head, agentId: positional[0], json };
    case "list":
      only(flags, ["--json"]);
      if (positional.length > 1) {
        throw new UsageError("usage: argus list [dir]");
      }

      return { kind: "list", dir: positional[0] ?? ".", json };
    default:
      throw new UsageError(`unknown command ${head}`);
  }
}

export const HELP = `argus — drive Argus sessions from a terminal or a script

Usage:
  argus session new <dir> <prompt|-> [--worktree <base>] [--name <name>]
                    [--model <id>] [--mode <permission-mode>] [--wait] [--timeout <s>]
  argus send <agent-id> <message|-> [--wait] [--timeout <s>]
  argus wait <agent-id> [--timeout <s>]
  argus show <agent-id>
  argus list [dir]
  argus stop <agent-id>

  <dir> is any directory inside a project. Pass - to read the prompt or message
  from stdin. Without --worktree the agent works in the project's own checkout;
  --worktree <base> gives it a new worktree off <base> (HEAD for the current
  branch). Add --json for machine-readable output.

Exit codes:
  0  done (the agent finished its turn)
  1  the agent or the command failed
  2  usage error
  3  the agent is waiting for input — answer it in Argus
  4  Argus isn't running
  124  --timeout elapsed first
`;
