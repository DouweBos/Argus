/**
 * Shared types for chat history persistence.
 *
 * The index shapes come from the command catalog; `SavedConversation` narrows
 * the host's opaque messages to the renderer's own.
 */

import type { ConversationMessage } from "../stores/conversationStore";
import type { ChatHistoryEntry } from "@argus/remote-protocol";

export type {
  ChatHistoryEntry,
  ChatHistoryMessageMatch,
  ChatHistorySearchResult,
} from "@argus/remote-protocol";

/** Full saved conversation — index entry + the renderer's messages. */
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
