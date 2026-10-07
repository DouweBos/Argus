import type {
  AgentConversation,
  ConversationMessage,
} from "@argus/host/services/agent/conversation/types";

/**
 * Messages are immutable — the reducer replaces the ones that change — so each
 * one's JSON is computed once. Re-publishing a long transcript then costs the
 * new tail, not a full `JSON.stringify` of every message per event burst.
 */
const messageJson = new WeakMap<ConversationMessage, string>();

/** `JSON.stringify(conversation)`, with `messages` serialized last. */
export function serializeConversation(conversation: AgentConversation): string {
  const { messages, ...rest } = conversation;
  const parts = messages.map((message) => {
    let json = messageJson.get(message);
    if (json === undefined) {
      json = JSON.stringify(message);
      messageJson.set(message, json);
    }

    return json;
  });
  const head = JSON.stringify(rest);
  const separator = head === "{}" ? "" : ",";

  return `${head.slice(0, -1)}${separator}"messages":[${parts.join(",")}]}`;
}
