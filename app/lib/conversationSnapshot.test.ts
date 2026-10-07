import type {
  AgentConversation,
  ConversationMessage,
} from "@argus/host/services/agent/conversation/types";
import { describe, expect, it } from "vitest";
import { serializeConversation } from "./conversationSnapshot";

function message(id: string, text: string): ConversationMessage {
  return {
    id,
    role: "assistant",
    textBlocks: [text],
    toolCalls: [],
    timestamp: 1,
  };
}

describe("serializeConversation", () => {
  it("round-trips to the same conversation", () => {
    const conversation: AgentConversation = {
      messages: [message("a", "one"), message("b", 'two "quoted"')],
      model: "claude-opus-5",
      title: undefined,
      todos: null,
    };

    expect(JSON.parse(serializeConversation(conversation))).toEqual(
      JSON.parse(JSON.stringify(conversation)),
    );
  });

  it("handles a conversation with nothing but messages", () => {
    expect(JSON.parse(serializeConversation({ messages: [] }))).toEqual({
      messages: [],
    });
  });

  it("reuses an unchanged message's JSON and picks up a replaced one", () => {
    const first = message("a", "one");
    serializeConversation({ messages: [first] });
    const replaced = { ...first, textBlocks: ["edited"] };

    expect(
      JSON.parse(serializeConversation({ messages: [first, replaced] }))
        .messages,
    ).toEqual([first, replaced]);
  });
});
