import type { AgentTranscriptPage } from "@argus/remote-protocol";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyTranscriptDelta,
  applyTranscriptPage,
  clearConversation,
  flushPendingUnread,
  getConversationState,
} from "./conversationStore";

const AGENT = "a1";

const page: AgentTranscriptPage = {
  epoch: "e",
  revision: 1,
  start: 0,
  total: 1,
  messages: [
    { id: "u", role: "user", textBlocks: ["hi"], toolCalls: [], timestamp: 0 },
  ],
  meta: { title: "Hi" },
};

function reply(id: string, text: string) {
  return {
    id,
    role: "assistant" as const,
    textBlocks: [text],
    toolCalls: [],
    timestamp: 1,
  };
}

describe("conversationStore", () => {
  beforeEach(() => clearConversation(AGENT));

  it("marks a streamed reply unread once the turn is over, and forgets it when removed", () => {
    applyTranscriptPage(AGENT, page);
    expect(
      applyTranscriptDelta(AGENT, {
        agentId: AGENT,
        epoch: "e",
        revision: 2,
        total: 2,
        ops: [{ op: "append", index: 1, message: reply("r", "Done") }],
      }),
    ).toBe("applied");
    flushPendingUnread(AGENT);
    expect([...getConversationState().unreadMessages[AGENT]!]).toEqual(["r"]);

    applyTranscriptDelta(AGENT, {
      agentId: AGENT,
      epoch: "e",
      revision: 3,
      total: 1,
      ops: [{ op: "remove", index: 1, id: "r" }],
    });
    expect(getConversationState().unreadMessages[AGENT]).toBeUndefined();
  });

  it("reports a gap for a conversation it hasn't loaded", () => {
    expect(
      applyTranscriptDelta(AGENT, {
        agentId: AGENT,
        epoch: "e",
        revision: 1,
        total: 0,
        ops: [],
      }),
    ).toBe("gap");
  });
});
