import type { ConversationMessage } from "../stores/conversationStore";
import { updateAgent } from "../stores/agentStore";
import {
  getConversationState,
  setConversationState,
} from "../stores/conversationStore";
import { notifyMessageSent } from "./agentEventService";
import { restoreAgentAtTurn, sendAgentMessage } from "./ipc";

function countUserTurns(
  messages: ConversationMessage[],
  upToIdxExclusive: number,
): number {
  let n = 0;
  for (let i = 0; i < upToIdxExclusive; i++) {
    if (messages[i].role === "user") {
      n += 1;
    }
  }

  return n;
}

/**
 * Edit a user message and restore the conversation to that point.
 *
 * The heavy lifting happens in the backend's `restoreAgentAtTurn` handler:
 * it kills the current child process, forks the Claude JSONL to the target
 * turn, and respawns a new child under the **same** agent id. From the
 * frontend's point of view the agent never went away — no listener rebind,
 * no conversation migration, no state swap.
 *
 * When editing the very first user message (`keepTurnNumber === 0`) the
 * backend starts fresh instead (CLI rejects a --resume on a JSONL with no
 * user turns).
 */
export async function editAndRestoreFromMessage(
  _sessionId: string,
  agentId: string,
  messageId: string,
  newText: string,
): Promise<void> {
  const conversation = getConversationState().conversations[agentId];
  if (!conversation) {
    throw new Error("Conversation not found");
  }
  const claudeSessionId = conversation.sessionId;
  if (!claudeSessionId) {
    throw new Error("Session is missing a Claude session id to restore from");
  }
  const idx = conversation.messages.findIndex((m) => m.id === messageId);
  if (idx < 0) {
    throw new Error("Message not found");
  }
  const editMessage = conversation.messages[idx];
  if (editMessage.role !== "user") {
    throw new Error("Only user messages can be edited");
  }

  const keepTurnNumber = countUserTurns(conversation.messages, idx);
  const backfill = conversation.messages.slice(0, idx).map((m) => ({ ...m }));

  // Pin the indicator to "running" and mark the agent in-flight for the
  // whole dance. Backend suppresses status emits during the restore window
  // so nothing flips this back to idle before we send.
  notifyMessageSent(agentId);
  updateAgent(agentId, { status: "running" });

  // Replace the frontend transcript with the truncated backfill + the
  // edited user message. Same agentId — no migration needed.
  setConversationState((state) => {
    const existing = state.conversations[agentId];
    if (!existing) {
      return state;
    }
    const userMsg: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "user",
      textBlocks: [newText],
      toolCalls: [],
      timestamp: Date.now(),
    };

    return {
      conversations: {
        ...state.conversations,
        [agentId]: {
          ...existing,
          // sessionId will be refreshed from the backend response once the
          // respawn is done.
          sessionId: undefined,
          resuming: false,
          lastEventType: "user_sent",
          messages: [...backfill, userMsg],
          queuedMessages: [],
        },
      },
    };
  });

  // Backend kills + forks + respawns atomically under the same agentId.
  const { claude_session_id: newClaudeSessionId } = await restoreAgentAtTurn(
    agentId,
    claudeSessionId,
    keepTurnNumber,
    editMessage.timestamp,
  );

  // Update the sessionId reference on the (unchanged) conversation slot.
  setConversationState((state) => {
    const existing = state.conversations[agentId];
    if (!existing) {
      return state;
    }

    return {
      conversations: {
        ...state.conversations,
        [agentId]: {
          ...existing,
          sessionId: newClaudeSessionId ?? undefined,
        },
      },
    };
  });

  await sendAgentMessage(agentId, newText);
}
