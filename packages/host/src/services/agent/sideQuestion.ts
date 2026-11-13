/**
 * Side questions: ask a running agent something without touching its turn.
 * On stock Claude Code a forked, read-only, unpersisted `claude -p` reads the agent's
 * transcript; other runners get a read-only one-shot seeded with the chat.
 * Nothing is written back to the conversation the agent works from.
 */

import { execFile } from "node:child_process";
import { warn } from "@argus/host/logger";
import { appState } from "../../state";
import {
  envForAccount,
  resolveAccountForSession,
} from "../claudeAuth/accounts";
import { ensureClaudeTranscriptAt } from "../llm/runners/claudeCode/transcriptFork";
import { capture } from "../telemetry/telemetry";
import { telemetryRunner } from "./agentService";
import { historySeed } from "./conversation/actions";
import { liveConversation } from "./conversation/live";

const TIMEOUT_MS = 180_000;
export const MAX_SIDE_QUESTION_CHARS = 4000;
const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"];

const SYSTEM_PROMPT =
  "The user is asking you a side question while your task carries on elsewhere. " +
  "Answer it from the conversation so far, reading files if you must. " +
  "Do not continue, change or plan the task, and do not offer to; you cannot edit anything here. " +
  "Answer briefly.";

export interface SideAnswer {
  answer: string;
}

/** The CLI args for one side question, resuming `claudeSessionId` as a throwaway fork. */
export function sideQuestionArgs(opts: {
  claudeSessionId: string;
  model: string | null;
  question: string;
}): string[] {
  return [
    "-p",
    "--resume",
    opts.claudeSessionId,
    "--fork-session",
    "--no-session-persistence",
    ...(opts.model ? ["--model", opts.model] : []),
    "--output-format",
    "json",
    "--tools",
    ...READ_ONLY_TOOLS,
    // No hooks, MCP servers or slash commands: the answer can't act on anything.
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--append-system-prompt",
    SYSTEM_PROMPT,
    "--",
    opts.question,
  ];
}

function durationBucket(ms: number): "<10s" | "10-30s" | "30-90s" | "90s+" {
  if (ms < 10_000) {
    return "<10s";
  }
  if (ms < 30_000) {
    return "10-30s";
  }

  return ms < 90_000 ? "30-90s" : "90s+";
}

/** Ask `agentId` a question on a fork of its context. Throws a string on failure. */
export async function askSideQuestion(
  agentId: string,
  question: string,
): Promise<SideAnswer> {
  const text = question.trim();
  if (!text) {
    throw "Ask a question first";
  }
  if (text.length > MAX_SIDE_QUESTION_CHARS) {
    throw "That side question is too long";
  }
  const agent = appState.agents.get(agentId);
  if (!agent) {
    throw `Agent not found: ${agentId}`;
  }
  if (!agent.runner.capabilities().supportsSideQuestion) {
    throw `${agent.runner.displayName} can't answer side questions`;
  }
  const session = appState.sessions.get(agent.sessionId);
  if (!session) {
    throw `Session not found: ${agent.sessionId}`;
  }
  const conversation = liveConversation(agentId);
  const claudeSessionId = conversation?.sessionId;
  // A custom runner's gateway env lives in its one-shot, not in `claude`'s.
  const claude = agent.runner.id === "claude-code";
  if (claude ? !claudeSessionId : !conversation?.messages.length) {
    throw "This agent has no conversation to ask about yet";
  }

  const busy = agent.status === "running";
  const started = Date.now();
  const report = (success: boolean) =>
    capture("agent_side_question", {
      agent_busy: busy,
      duration_bucket: durationBucket(Date.now() - started),
      runner: telemetryRunner(agent.runner),
      success,
    });
  const env = envForAccount(
    agent.accountId ?? resolveAccountForSession(session),
  );
  try {
    if (!claude || !claudeSessionId) {
      const answer = await agent.runner.oneShot({
        prompt: `${historySeed(conversation?.messages ?? [], agent.runner)}\n\n## Side question\n\n${text}`,
        systemPrompt: SYSTEM_PROMPT,
        cwd: session.path,
        model: agent.model ?? undefined,
        env,
        timeoutMs: TIMEOUT_MS,
        source: "side_question",
      });
      if (!answer) {
        throw "The side question got no answer";
      }
      report(true);

      return { answer };
    }
    try {
      ensureClaudeTranscriptAt(session.path, claudeSessionId);
    } catch {
      // The CLI reports a missing transcript itself.
    }
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        "claude",
        sideQuestionArgs({
          claudeSessionId,
          model: agent.model,
          question: text,
        }),
        {
          cwd: session.path,
          env,
          timeout: TIMEOUT_MS,
          maxBuffer: 4 * 1024 * 1024,
        },
        (err, out) => (err ? reject(err) : resolve(out)),
      );
      child.stdin?.end();
    });
    const parsed = JSON.parse(stdout) as {
      is_error?: boolean;
      result?: string;
    };
    const answer = parsed.result?.trim();
    if (parsed.is_error || !answer) {
      throw answer || "The side question got no answer";
    }
    report(true);

    return { answer };
  } catch (e) {
    report(false);
    warn(`[agent:${agentId}] side question failed:`, e);
    if (typeof e === "string") {
      throw e;
    }
    const err = e as { killed?: boolean; code?: number | string };
    if (err.killed) {
      throw "The side question timed out";
    }
    throw "The side question failed";
  }
}
