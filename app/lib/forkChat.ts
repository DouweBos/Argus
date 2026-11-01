import { getAgentState } from "../stores/agentStore";
import { addSession, selectSession } from "../stores/sessionStore";
import { startAgentInSession } from "./agentLifecycle";
import { agentForkPoint, forkChatInSession, forkSession } from "./ipc";

/**
 * Fork a chat + its workspace from a given message.
 *
 * - Creates a new worktree pinned to the newest commit at or before the fork
 *   message's timestamp — no state from after the fork point is carried over.
 * - Copies the source Claude Code JSONL into the new worktree's Claude project
 *   dir, truncated at the fork turn with sessionId/cwd/branch rewritten, so
 *   the spawned agent resumes with a real, truncated conversation history.
 */
export async function forkChatFromMessage(
  sourceSessionId: string,
  agentId: string,
  forkMessageId: string,
  branch: string,
  description: string,
): Promise<void> {
  // The host has the whole history; this window may only have its tail.
  const point = await agentForkPoint(agentId, forkMessageId);

  const { session: newSession, claude_session_id: newClaudeSessionId } =
    await forkSession(
      sourceSessionId,
      branch,
      description,
      point.timestampMs,
      point.turnNumber,
      point.claudeSessionId,
      point.replayOps,
    );

  addSession(newSession);
  selectSession(newSession.id);

  // The host seeds the new agent's transcript with the history up to the fork.
  await startAgentInSession(newSession.id, {
    focus: true,
    resumeSessionId: newClaudeSessionId ?? undefined,
    ...sourceSettings(agentId),
    seedFrom: { agentId, throughMessageId: forkMessageId },
  });
}

/**
 * Fork a chat into a new agent within the *existing* session — keeps the
 * same worktree and creates a fresh agent with the conversation truncated
 * at the fork message.
 */
export async function forkChatIntoNewAgent(
  sessionId: string,
  agentId: string,
  forkMessageId: string,
): Promise<void> {
  const point = await agentForkPoint(agentId, forkMessageId);
  if (!point.claudeSessionId) {
    throw new Error("Conversation has no Claude session id to fork from");
  }

  const { claude_session_id: newClaudeSessionId } = await forkChatInSession(
    sessionId,
    point.claudeSessionId,
    point.timestampMs,
    point.turnNumber,
  );

  await startAgentInSession(sessionId, {
    focus: true,
    resumeSessionId: newClaudeSessionId ?? undefined,
    ...sourceSettings(agentId),
    seedFrom: { agentId, throughMessageId: forkMessageId },
  });
}

/** The source's runner, model and mode, so a fork doesn't fall back to the defaults. */
function sourceSettings(agentId: string): {
  model?: string;
  permissionMode?: string;
  runnerId?: string;
} {
  const source = getAgentState().agents[agentId];

  return {
    runnerId: source?.runner_id,
    model: source?.model ?? undefined,
    permissionMode: source?.permission_mode ?? undefined,
  };
}
