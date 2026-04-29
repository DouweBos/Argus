/**
 * Shared plumbing for one-shot `claude -p` invocations.
 *
 * Every flow that shells out to the Claude Code CLI for a short, structured
 * response (session titles, branch slugs, chat titles) funnels through here
 * so they share timeout, error classification, and user-facing failure
 * notifications. Returns the inner `.result` string on success, or null on
 * any failure (timeout, missing binary, non-zero exit, parse error).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { warn } from "../../../app/lib/logger";
import { broadcastNotification } from "../notifications/broadcast";

const execFileAsync = promisify(execFile);

const CLAUDE_BIN = "claude";
export const DEFAULT_TIMEOUT_MS = 90_000;
const BROADCAST_COOLDOWN_MS = 10_000;

interface PrintResult {
  result?: string;
  is_error?: boolean;
}

export interface RunClaudePrintOptions {
  prompt: string;
  timeoutMs?: number;
  cwd?: string;
  source: string;
}

let lastBroadcastAt = 0;

/**
 * Turn a raw execFile error into a user-facing message. `code: 143` + `killed`
 * means the timeout fired — the most common cause is an expired Claude Code
 * login where `claude -p` stalls waiting for auth. ENOENT means the `claude`
 * binary isn't on PATH.
 */
function extractResultFromStdout(stdout: unknown): string | null {
  if (typeof stdout !== "string" || !stdout.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(stdout) as PrintResult;

    return typeof parsed.result === "string" ? parsed.result.trim() : null;
  } catch {
    return null;
  }
}

function describeClaudeFailure(e: unknown): string {
  const err = e as {
    code?: number | string;
    killed?: boolean;
    stderr?: string;
    stdout?: string;
  };
  if (err?.code === "ENOENT") {
    return "Claude Code CLI (`claude`) not found on PATH. Install it or add it to your shell PATH so Argus can generate session titles.";
  }
  if (err?.killed || err?.code === 143) {
    return "`claude -p` timed out. Your Claude Code login has likely expired — run `claude` in a terminal to re-authenticate. Argus fell back to a branch slug derived from your prompt.";
  }
  const stderr = typeof err?.stderr === "string" ? err.stderr.trim() : "";
  if (/auth|login|credential|unauthori[sz]ed/i.test(stderr)) {
    return "Claude Code authentication failed. Run `claude` in a terminal to re-authenticate. Argus fell back to a branch slug derived from your prompt.";
  }

  const innerResult = extractResultFromStdout(err?.stdout);
  if (innerResult) {
    return `Claude Code title generation failed: ${innerResult}. Argus fell back to a branch slug derived from your prompt.`;
  }

  return `Claude Code title generation failed${stderr ? `: ${stderr}` : ""}. Argus fell back to a branch slug derived from your prompt.`;
}

function broadcastFailure(source: string, e: unknown): void {
  const now = Date.now();
  if (now - lastBroadcastAt < BROADCAST_COOLDOWN_MS) {
    return;
  }
  lastBroadcastAt = now;
  broadcastNotification({
    level: "warning",
    message: describeClaudeFailure(e),
    source,
  });
}

export async function runClaudePrint(
  opts: RunClaudePrintOptions,
): Promise<string | null> {
  try {
    // Strip project context so haiku produces a title in one turn instead of
    // loading the worktree's CLAUDE.md / MCP / hooks / skills and trying to
    // "fix" the project with Bash. Without these flags a title call commonly
    // ran 30-90s and tripped the timeout, which surfaced as a misleading
    // "login expired" notification.
    const child = execFileAsync(
      CLAUDE_BIN,
      [
        "-p",
        "--model",
        "haiku",
        "--output-format",
        "json",
        "--tools",
        "",
        "--setting-sources",
        "user",
        "--disable-slash-commands",
        "--system-prompt",
        "You generate short titles and slugs. Reply with only what the user asks for, no tools, no explanation.",
        opts.prompt,
      ],
      {
        timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        cwd: opts.cwd,
      },
    );
    child.child.stdin?.end();
    const { stdout } = await child;

    const parsed = JSON.parse(stdout) as PrintResult;
    if (parsed.is_error || !parsed.result) {
      return null;
    }

    return parsed.result;
  } catch (e) {
    warn(`${opts.source} failed:`, e);
    broadcastFailure(opts.source, e);

    return null;
  }
}
