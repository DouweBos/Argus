/**
 * Codex runner: OpenAI's Codex CLI driven over `codex app-server`'s JSON-RPC
 * protocol, behind the runner-agnostic {@link LlmRunner} interface.
 *
 * No transcript fork (restore-at-turn) or side questions: both lean on Claude
 * Code's on-disk transcript, and the capabilities say so.
 */

import type {
  LlmRunner,
  LlmRunnerHandle,
  LlmRunnerSpawnArgs,
  OneShotArgs,
  PreflightResult,
  RunnerAuthProbe,
  RunnerSetup,
  RunnerCapabilities,
} from "../types";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { info } from "@argus/host/logger";
import { hostPlatform } from "@argus/host/platform";
import { runAuthProbe } from "../authProbe";
import { CODEX_RUNNER_ID, CodexHandle } from "./handle";
import { toCodexMcpServers } from "./mcpConfig";
import { runCodexExec } from "./oneShot";

const execFileAsync = promisify(execFile);

const CODEX_BIN = "codex";
const NOT_FOUND = `Codex CLI (\`${CODEX_BIN}\`) not found on PATH. Install it with \`npm install -g @openai/codex\` and run \`codex login\`.`;

export class CodexRunner implements LlmRunner {
  readonly id = CODEX_RUNNER_ID;
  readonly displayName = "Codex";

  capabilities(): RunnerCapabilities {
    return {
      supportsMcp: true,
      supportsTranscriptFork: false,
      supportsSetModel: true,
      supportsSetPermissionMode: true,
      supportsSetEffort: true,
      supportsInterrupt: true,
      supportsSideQuestion: false,
    };
  }

  async preflight(): Promise<PreflightResult> {
    try {
      const { stdout } = await execFileAsync("which", [CODEX_BIN]);
      const resolved = stdout.trim();

      return resolved
        ? { ok: true, binPath: resolved }
        : { ok: false, reason: NOT_FOUND };
    } catch {
      return { ok: false, reason: NOT_FOUND };
    }
  }

  setup(): RunnerSetup {
    return {
      installCommand: "npm install -g @openai/codex",
      installUrl: null,
      loginCommand: "codex login",
      logoutCommand: "codex logout",
    };
  }

  async authStatus(): Promise<RunnerAuthProbe> {
    const pre = await this.preflight();

    return pre.ok
      ? runAuthProbe(pre.binPath, {
          args: ["login", "status"],
          parse: parseCodexLoginStatus,
        })
      : { signedIn: null, account: null };
  }

  async spawn(args: LlmRunnerSpawnArgs): Promise<LlmRunnerHandle> {
    const child = spawn(CODEX_BIN, ["app-server"], {
      cwd: args.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...(args.env ?? process.env), RUST_LOG: "warn" },
    });
    info(`[agent:${args.agentId}] spawned codex app-server`);

    return new CodexHandle({
      agentId: args.agentId,
      child,
      cwd: args.cwd,
      model: args.model,
      permissionMode: args.permissionMode,
      resumeRef: args.resumeRef,
      developerInstructions: args.systemPrompt,
      mcpServers: toCodexMcpServers(args.mcpServers),
      permissionPreHook: args.permissionPreHook,
      disallowedTools: args.disallowedTools,
      clientVersion: hostPlatform().appVersion(),
    });
  }

  async oneShot(args: OneShotArgs): Promise<string | null> {
    return runCodexExec(CODEX_BIN, args);
  }
}

/**
 * "Not logged in" (exit 1), "Logged in using ChatGPT", or "API key configured -
 * sk-…" — the masked key is never kept.
 */
export function parseCodexLoginStatus(
  output: string,
  exitCode: number,
): RunnerAuthProbe {
  if (/not logged in/i.test(output)) {
    return { signedIn: false, account: null };
  }
  if (/api key configured/i.test(output)) {
    return { signedIn: true, account: "API key" };
  }
  const using = /logged in using\s+([A-Za-z][A-Za-z ]*[A-Za-z])/i.exec(output);
  if (using && exitCode === 0) {
    return { signedIn: true, account: using[1] ?? null };
  }

  return { signedIn: null, account: null };
}
