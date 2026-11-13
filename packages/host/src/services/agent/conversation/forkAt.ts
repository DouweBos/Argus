/**
 * Fork a chat at one of its messages into a new agent, the whole of what a
 * client's "Fork chat" does, so a remote needs one round trip instead of four.
 */

import type { AgentForkPoint } from "./actions";
import type { LlmRunner } from "../../llm/runners/types";
import type { AgentInfo } from "../models";
import { warn } from "@argus/host/logger";
import { appState } from "../../../state";
import { forkChatInSession, forkSession } from "../../session/manager";
import { capture } from "../../telemetry/telemetry";
import { launchAgent, setAgentEffort, telemetryRunner } from "../agentService";
import {
  agentForkPoint,
  forkSeed,
  isClaudeRunner,
  requireTranscriptFork,
  seedForkedConversation,
} from "./actions";

/** The runner's own fork into `destSessionId`, or null to fall back to a seed. */
async function nativeFork(
  runner: LlmRunner,
  point: AgentForkPoint,
  sourceSessionId: string,
  destSessionId: string,
): Promise<string | null> {
  const source = appState.sessions.get(sourceSessionId);
  const dest = appState.sessions.get(destSessionId);
  if (!runner.forkTranscript || !point.claudeSessionId || !source || !dest) {
    return null;
  }
  try {
    const forked = await runner.forkTranscript({
      sourceRef: point.claudeSessionId,
      sourceCwd: source.path,
      destCwd: dest.path,
      destBranch: dest.branch,
      cutoffTimestampMs: point.timestampMs,
      keepTurnNumber: point.turnNumber,
    });

    return forked.resumeRef;
  } catch (e) {
    warn(`[${runner.id}] native fork failed, seeding instead: ${String(e)}`);

    return null;
  }
}

export async function forkChatAt(
  agentId: string,
  messageId: string,
  into: "agent" | "session",
  opts: { description?: string; branch?: string } = {},
): Promise<{ sessionId: string; agent: AgentInfo }> {
  const source = appState.agents.get(agentId);
  if (!source) {
    throw `Agent not found: ${agentId}`;
  }
  requireTranscriptFork(source.runner);
  const point = agentForkPoint(agentId, messageId);
  const claude = isClaudeRunner(source.runner);
  let sessionId = source.sessionId;
  let resume: string | null;
  if (into === "session") {
    const description = opts.description?.trim() ?? "";
    if (!description) {
      throw "A forked session needs a description";
    }
    const forked = await forkSession(
      source.sessionId,
      opts.branch?.trim() ?? "",
      description,
      point.timestampMs,
      point.turnNumber,
      claude ? point.claudeSessionId : null,
      point.replayOps,
    );
    sessionId = forked.session.id;
    resume = claude
      ? forked.claude_session_id
      : await nativeFork(source.runner, point, source.sessionId, sessionId);
  } else if (claude) {
    if (!point.claudeSessionId) {
      throw "This conversation has no Claude session to fork from yet";
    }
    const forked = await forkChatInSession(
      source.sessionId,
      point.claudeSessionId,
      point.timestampMs,
      point.turnNumber,
    );
    resume = forked.claude_session_id;
  } else {
    resume = await nativeFork(source.runner, point, sessionId, sessionId);
  }
  // The new agent's transcript starts as the chat up to the fork, on the
  // source's runner, model and mode rather than the host's defaults.
  const agent = await launchAgent({
    sessionId,
    model: source.model ?? undefined,
    permissionMode: source.permissionMode ?? undefined,
    runnerId: source.runner.id,
    resumeSessionId: resume ?? undefined,
    fresh: true,
  });
  const started = appState.agents.get(agent.agent_id);
  if (!resume && started) {
    started.pendingSeed = forkSeed(agentId, messageId);
  }
  if (source.effort) {
    await setAgentEffort(agent.agent_id, source.effort).catch((e: unknown) =>
      warn(`[agent:${agent.agent_id}] fork kept no effort: ${String(e)}`),
    );
  }
  seedForkedConversation(
    agent.agent_id,
    { agentId, throughMessageId: messageId },
    resume ?? undefined,
    claude && resume != null,
  );
  capture("agent_chat_forked", {
    into,
    runner: telemetryRunner(source.runner),
    history: resume ? "native" : "seeded",
  });

  return { sessionId, agent };
}
