/**
 * Shared types for chat history persistence.
 *
 * Used by both the frontend (IPC wrappers, components) and the backend
 * (chatHistory service). Keep in sync with the backend service's file format.
 */

import type { ConversationMessage } from "../stores/conversationStore";

/** Lightweight summary stored in the index file — enough for list rendering. */
export interface ChatHistoryEntry {
  createdAt: number;
  endedAt: number;
  id: string;
  messageCount: number;
  model?: string;
  sessionId: string;
  title: string;
  totalCost?: number;
  totalDuration?: number;
  workspaceBranch: string;
  workspaceDescription: string;
}

/** Full saved conversation — index entry + all messages. */
export interface SavedConversation extends ChatHistoryEntry {
  messages: ConversationMessage[];
}

/** Derive a short title from the first user message in a conversation. */
export function deriveTitle(messages: ConversationMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser || firstUser.textBlocks.length === 0) {
    return "Untitled conversation";
  }
  const text = firstUser.textBlocks[0];
  if (text.length <= 80) {
    return text;
  }

  return text.slice(0, 77) + "...";
}
