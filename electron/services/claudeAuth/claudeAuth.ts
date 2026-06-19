/**
 * Claude account authentication.
 *
 * Wraps the Claude CLI's `claude auth` subcommands so users can view their
 * current account, log out, and log in/switch accounts from inside Argus —
 * instead of dropping to a terminal to run `claude auth login`.
 *
 * `status` and `logout` are non-interactive (plain execFile). `login` is
 * interactive: the CLI opens a browser, then waits on stdin for a pasted
 * authorization code. We keep that child process alive between
 * {@link claudeLoginStart} (returns the auth URL) and
 * {@link claudeLoginSubmitCode} (writes the code, waits for exit).
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { info } from "../../../app/lib/logger";

const execFileAsync = promisify(execFile);

const CLAUDE_BIN = "claude";

export interface ClaudeAuthStatus {
  loggedIn: boolean;
  authMethod?: string;
  apiProvider?: string;
  email?: string;
  orgId?: string;
  orgName?: string;
  subscriptionType?: string;
}

/** Read the current Claude account status via `claude auth status --json`. */
export async function getClaudeAuthStatus(): Promise<ClaudeAuthStatus> {
  try {
    const { stdout } = await execFileAsync(
      CLAUDE_BIN,
      ["auth", "status", "--json"],
      { timeout: 12_000 },
    );
    const parsed = JSON.parse(stdout) as Partial<ClaudeAuthStatus>;

    return {
      loggedIn: parsed.loggedIn ?? false,
      authMethod: parsed.authMethod,
      apiProvider: parsed.apiProvider,
      email: parsed.email,
      orgId: parsed.orgId,
      orgName: parsed.orgName,
      subscriptionType: parsed.subscriptionType,
    };
  } catch {
    // CLI missing, errored, or no credentials — treat as logged out.
    return { loggedIn: false };
  }
}

/** Log out of the current Claude account via `claude auth logout`. */
export async function claudeLogout(): Promise<void> {
  await execFileAsync(CLAUDE_BIN, ["auth", "logout"], { timeout: 12_000 });
}

// Only one interactive login can be in flight at a time. The `claude auth
// login` child lives here between start and code submission.
let loginChild: ChildProcess | null = null;

function killLoginChild(): void {
  if (loginChild && !loginChild.killed) {
    loginChild.kill("SIGTERM");
  }
  loginChild = null;
}

/**
 * Begin an interactive login. Spawns `claude auth login`, reads its stdout
 * until the authorization URL appears, and returns it. The child stays alive
 * waiting on stdin for the code submitted via {@link claudeLoginSubmitCode}.
 */
export async function claudeLoginStart(args: {
  useConsole?: boolean;
}): Promise<{ url: string }> {
  // Abandon any previous in-flight attempt.
  killLoginChild();

  const cliArgs = [
    "auth",
    "login",
    args.useConsole ? "--console" : "--claudeai",
  ];
  const child = spawn(CLAUDE_BIN, cliArgs, {
    stdio: ["pipe", "pipe", "pipe"],
  });
  loginChild = child;

  return new Promise<{ url: string }>((resolve, reject) => {
    let buffer = "";
    let settled = false;

    const onChunk = (chunk: Buffer) => {
      buffer += chunk.toString();
      const match = buffer.match(/https?:\/\/\S+/);
      if (match && !settled) {
        settled = true;
        cleanup();
        resolve({ url: match[0] });
      }
    };

    const onExit = (code: number | null) => {
      if (!settled) {
        settled = true;
        cleanup();
        loginChild = null;
        reject(`claude auth login exited early (code ${code ?? "null"})`);
      }
    };

    const onError = (err: Error) => {
      if (!settled) {
        settled = true;
        cleanup();
        loginChild = null;
        reject(`Failed to start claude auth login: ${err.message}`);
      }
    };

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        killLoginChild();
        reject("Timed out waiting for the Claude login URL.");
      }
    }, 20_000);

    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off("data", onChunk);
      child.stderr?.off("data", onChunk);
      child.off("exit", onExit);
      child.off("error", onError);
    };

    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.on("exit", onExit);
    child.on("error", onError);
  });
}

/**
 * Finish an interactive login by writing the pasted authorization code to the
 * waiting child's stdin and resolving once it exits.
 */
export async function claudeLoginSubmitCode(args: {
  code: string;
}): Promise<{ ok: boolean; error?: string }> {
  const child = loginChild;
  if (!child || child.killed || !child.stdin) {
    return { ok: false, error: "No login in progress. Start the login again." };
  }

  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    let output = "";

    const onChunk = (chunk: Buffer) => {
      output += chunk.toString();
    };

    const onExit = (code: number | null) => {
      cleanup();
      loginChild = null;
      if (code === 0) {
        resolve({ ok: true });
      } else {
        const tail = output.trim().split("\n").slice(-3).join(" ").trim();
        resolve({
          ok: false,
          error: tail || `Login failed (exit code ${code ?? "null"}).`,
        });
      }
    };

    const onError = (err: Error) => {
      cleanup();
      loginChild = null;
      resolve({ ok: false, error: err.message });
    };

    const cleanup = () => {
      child.stdout?.off("data", onChunk);
      child.stderr?.off("data", onChunk);
      child.off("exit", onExit);
      child.off("error", onError);
    };

    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.on("exit", onExit);
    child.on("error", onError);

    info("[claudeAuth] submitting login code");
    child.stdin?.write(`${args.code.trim()}\n`);
  });
}

/** Cancel an in-flight interactive login, killing the child process. */
export function claudeLoginCancel(): void {
  killLoginChild();
}
