/**
 * Fork a chat at one of its messages into a new agent, the whole of what a
 * client's "Fork chat" does, so a remote needs one round trip instead of four.
 */

import type { AgentInfo } from "../models";
import { warn } from "@argus/host/logger";
import { appState } from "../../../state";
import { forkChatInSession, forkSession } from "../../session/manager";
import { launchAgent, setAgentEffort } from "../agentService";
import {
  agentForkPoint,
  requireTranscriptFork,
  seedForkedConversation,
} from "./actions";

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
      point.claudeSessionId,
      point.replayOps,
    );
    sessionId = forked.session.id;
    resume = forked.claude_session_id;
  } else {
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
  if (source.effort) {
    await setAgentEffort(agent.agent_id, source.effort).catch((e: unknown) =>
      warn(`[agent:${agent.agent_id}] fork kept no effort: ${String(e)}`),
    );
  }
  seedForkedConversation(
    agent.agent_id,
    { agentId, throughMessageId: messageId },
    resume ?? undefined,
  );

  return { sessionId, agent };
}
