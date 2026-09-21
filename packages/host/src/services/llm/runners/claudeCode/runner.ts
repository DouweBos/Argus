/**
 * Claude Code runner.
 *
 * Wraps the Claude Code CLI (`claude --print --output-format stream-json
 * --input-format stream-json --verbose --permission-prompt-tool stdio`)
 * behind the runner-agnostic {@link LlmRunner} interface. This is the only
 * runner registered today.
 */

import type {
  LlmRunner,
  LlmRunnerSpawnArgs,
  LlmRunnerHandle,
  OneShotArgs,
  ForkTranscriptArgs,
  PreflightResult,
  RunnerCapabilities,
} from "../types";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { info } from "@argus/host/logger";
import { ClaudeCodeHandle } from "./handle";
import { runClaudePrint } from "./oneShot";
import { toClaudePermissionMode } from "./permissionModes";
import { forkClaudeSessionFile } from "./transcriptFork";

const execFileAsync = promisify(execFile);

const CLAUDE_BIN = "claude";

export class ClaudeCodeRunner implements LlmRunner {
  readonly id = "claude-code";
  readonly displayName = "Claude Code";

  capabilities(): RunnerCapabilities {
    return {
      supportsMcp: true,
      supportsTranscriptFork: true,
      supportsSetModel: true,
      supportsSetPermissionMode: true,
      supportsSetEffort: true,
      supportsInterrupt: true,
    };
  }

  async preflight(): Promise<PreflightResult> {
    try {
      const { stdout } = await execFileAsync("which", [CLAUDE_BIN]);
      const resolved = stdout.trim();
      if (!resolved) {
        return {
          ok: false,
          reason: `Claude Code CLI (\`${CLAUDE_BIN}\`) not found on PATH. Install it first: https://docs.anthropic.com/en/docs/claude-code`,
        };
      }

      return { ok: true, binPath: resolved };
    } catch {
      return {
        ok: false,
        reason: `Claude Code CLI (\`${CLAUDE_BIN}\`) not found on PATH. Install it first: https://docs.anthropic.com/en/docs/claude-code`,
      };
    }
  }

  async spawn(args: LlmRunnerSpawnArgs): Promise<LlmRunnerHandle> {
    const cliArgs: string[] = [
      "--print",
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--verbose",
      "--debug-file",
      args.debugLogPath,
      "--permission-prompt-tool",
      "stdio",
    ];

    if (args.model) {
      cliArgs.push("--model", args.model);
    }
    const nativeMode = toClaudePermissionMode(args.permissionMode);
    if (nativeMode) {
      cliArgs.push("--permission-mode", nativeMode);
    }
    if (args.disallowedTools && args.disallowedTools.length > 0) {
      cliArgs.push("--disallowed-tools", ...args.disallowedTools);
    }
    if (args.resumeRef) {
      cliArgs.push("--resume", args.resumeRef);
    }
    if (Object.keys(args.mcpServers).length > 0) {
      cliArgs.push(
        "--mcp-config",
        JSON.stringify({ mcpServers: args.mcpServers }),
      );
    }

    const child = spawn(CLAUDE_BIN, cliArgs, {
      cwd: args.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: args.env,
    });

    info(`[agent:${args.agentId}] debug log: ${args.debugLogPath}`);

    if (!child.stdin || !child.stdout || !child.stderr) {
      throw `Failed to acquire stdio pipes for agent ${args.agentId}`;
    }

    return new ClaudeCodeHandle({
      agentId: args.agentId,
      child,
      stdin: child.stdin,
      combinedSystemPrompt: args.systemPrompt,
      permissionPreHook: args.permissionPreHook,
    });
  }

  async oneShot(args: OneShotArgs): Promise<string | null> {
    return runClaudePrint(args);
  }

  async forkTranscript(
    args: ForkTranscriptArgs,
  ): Promise<{ resumeRef: string | null }> {
    const newSessionId = await forkClaudeSessionFile({
      sourceCwd: args.sourceCwd,
      sourceSessionId: args.sourceRef,
      destCwd: args.destCwd,
      destBranch: args.destBranch,
      forkTimestampMs: args.cutoffTimestampMs,
      forkTurnNumber: args.keepTurnNumber,
    });

    return { resumeRef: newSessionId };
  }
}
