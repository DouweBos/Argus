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

export { deriveTitle } from "@argus/host/services/agent/conversation/reducer";
