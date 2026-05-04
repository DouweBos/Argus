import type { ConversationMessage } from "../stores/conversationStore";
import { updateAgent } from "../stores/agentStore";
import {
  getConversationState,
  setConversationState,
} from "../stores/conversationStore";
import { restoreAgentAtTurn, restoreCheckpoint } from "./ipc";

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
 * Restore both the worktree and the conversation to the point just before
 * `messageId` was sent. Files are reverted to the snapshot captured when the
 * message was originally dispatched; the conversation is rewound to the same
 * point and the original prompt is returned so the caller can put it back in
 * the input field.
 *
 * The agent is respawned in place under the same agentId — same flow used by
 * {@link editAndRestoreFromMessage}, just without sending a new prompt.
 */
export async function restoreFromMessage(
  sessionId: string,
  agentId: string,
  messageId: string,
): Promise<{ restoredPrompt: string }> {
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
  const targetMessage = conversation.messages[idx];
  if (targetMessage.role !== "user") {
    throw new Error("Only user messages can be restored from");
  }
  const checkpointId = targetMessage.checkpointId;
  if (!checkpointId) {
    throw new Error("This message has no checkpoint to restore from");
  }

  const keepTurnNumber = countUserTurns(conversation.messages, idx);
  const restoredPrompt = targetMessage.textBlocks.join("\n\n");

  // Pin the indicator while the dance plays out — backend silences status
  // emits until the new child is ready.
  updateAgent(agentId, { status: "running" });

  // Truncate the frontend transcript to the kept prefix.
  const backfill = conversation.messages.slice(0, idx).map((m) => ({ ...m }));
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
          sessionId: undefined,
          resuming: false,
          lastEventType: undefined,
          messages: backfill,
          queuedMessages: [],
        },
      },
    };
  });

  // Kill + fork transcript + respawn under the same agentId.
  const { claude_session_id: newClaudeSessionId } = await restoreAgentAtTurn(
    agentId,
    claudeSessionId,
    keepTurnNumber,
    targetMessage.timestamp,
  );

  // Rewind files. We do this after the conversation rewind so an agent that
  // is mid-edit can't race the restored files.
  await restoreCheckpoint(sessionId, checkpointId);

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

  updateAgent(agentId, { status: "idle" });

  return { restoredPrompt };
}
