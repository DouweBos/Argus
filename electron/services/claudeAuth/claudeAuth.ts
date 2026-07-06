/**
 * Claude account authentication.
 *
 * Wraps the Claude CLI's `claude auth` subcommands so users can view their
 * current account, log out, and log in/switch accounts from inside Argus —
 * instead of dropping to a terminal to run `claude auth login`.
 *
 * `status` and `logout` are non-interactive (plain execFile). `login` opens a
 * browser and completes over an OAuth loopback callback: the child exits on its
 * own once the browser redirects, no pasted code required. We keep the child
 * alive after {@link claudeLoginStart} returns the URL and emit a
 * `claude-auth:login-result` event when it exits. Some headless environments
 * still prompt for a code on stdin — we detect that and emit
 * `claude-auth:login-needs-code`, then {@link claudeLoginSubmitCode} writes it.
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { info } from "../../../app/lib/logger";
import { getMainWindow } from "../../main";

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
// login` child lives here between start and completion (browser callback or
// pasted code).
let loginChild: ChildProcess | null = null;
// Set while we're deliberately tearing a login down (cancel / restart) so its
// exit doesn't surface as a spurious login-result event.
let loginSuppressed = false;

function emitLoginResult(ok: boolean, error?: string): void {
  getMainWindow()?.webContents.send("claude-auth:login-result", { ok, error });
}

function killLoginChild(): void {
  if (loginChild && !loginChild.killed) {
    loginSuppressed = true;
    loginChild.kill("SIGTERM");
  }
  loginChild = null;
}

/** Trailing lines of CLI output, used to build an error message on failure. */
function outputTail(output: string): string {
  return output.trim().split("\n").slice(-3).join(" ").trim();
}

/**
 * Begin a login. Spawns `claude auth login`, reads its output until the
 * authorization URL appears, and returns it — the CLI has already opened the
 * browser. The child stays alive and completes over an OAuth loopback callback;
 * we emit `claude-auth:login-result` when it exits. If the CLI instead prompts
 * for a pasted code (headless), we emit `claude-auth:login-needs-code`.
 */
export async function claudeLoginStart(args: {
  useConsole?: boolean;
}): Promise<{ url: string }> {
  // Abandon any previous in-flight attempt.
  killLoginChild();
  loginSuppressed = false;

  const cliArgs = [
    "auth",
    "login",
    args.useConsole ? "--console" : "--claudeai",
  ];
  const child = spawn(CLAUDE_BIN, cliArgs, {
    stdio: ["pipe", "pipe", "pipe"],
  });
  loginChild = child;

  // Persistent listeners: outlive the URL promise so completion/failure of the
  // browser callback flow reaches the renderer.
  let output = "";
  let urlSettled = false;
  let needsCodeEmitted = false;

  const onOutput = (chunk: Buffer) => {
    output += chunk.toString();
    if (
      !needsCodeEmitted &&
      /paste|authorization code|enter the code/i.test(output)
    ) {
      needsCodeEmitted = true;
      getMainWindow()?.webContents.send("claude-auth:login-needs-code", {});
    }
  };

  const onExit = (code: number | null) => {
    detach();
    if (loginChild === child) {
      loginChild = null;
    }
    if (loginSuppressed) {
      loginSuppressed = false;

      return;
    }
    if (code === 0) {
      emitLoginResult(true);
    } else {
      emitLoginResult(
        false,
        outputTail(output) || `Login failed (exit code ${code ?? "null"}).`,
      );
    }
  };

  const onError = (err: Error) => {
    detach();
    if (loginChild === child) {
      loginChild = null;
    }
    if (loginSuppressed) {
      loginSuppressed = false;

      return;
    }
    emitLoginResult(false, `claude auth login failed: ${err.message}`);
  };

  const detach = () => {
    child.stdout?.off("data", onOutput);
    child.stderr?.off("data", onOutput);
    child.off("exit", onExit);
    child.off("error", onError);
  };

  child.stdout?.on("data", onOutput);
  child.stderr?.on("data", onOutput);
  child.on("exit", onExit);
  child.on("error", onError);

  return new Promise<{ url: string }>((resolve, reject) => {
    const onChunk = (chunk: Buffer) => {
      const match = (output + chunk.toString()).match(/https?:\/\/\S+/);
      if (match && !urlSettled) {
        urlSettled = true;
        stopWaiting();
        resolve({ url: match[0] });
      }
    };

    const onEarlyExit = () => {
      if (!urlSettled) {
        urlSettled = true;
        stopWaiting();
        reject("claude auth login exited before returning a URL.");
      }
    };

    const onEarlyError = (err: Error) => {
      if (!urlSettled) {
        urlSettled = true;
        stopWaiting();
        reject(`Failed to start claude auth login: ${err.message}`);
      }
    };

    const timer = setTimeout(() => {
      if (!urlSettled) {
        urlSettled = true;
        stopWaiting();
        killLoginChild();
        reject("Timed out waiting for the Claude login URL.");
      }
    }, 20_000);

    const stopWaiting = () => {
      clearTimeout(timer);
      child.stdout?.off("data", onChunk);
      child.stderr?.off("data", onChunk);
      child.off("exit", onEarlyExit);
      child.off("error", onEarlyError);
    };

    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.on("exit", onEarlyExit);
    child.on("error", onEarlyError);
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
