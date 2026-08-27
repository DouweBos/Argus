import type { ConversationMessage } from "../stores/conversationStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateAgent } from "../stores/agentStore";
import {
  getConversationState,
  setConversationState,
} from "../stores/conversationStore";
import { notifyMessageSent } from "./agentEventService";
import { editAndRestoreFromMessage } from "./editRestoreChat";
import { restoreAgentAtTurn, sendAgentMessage } from "./ipc";

vi.mock("./ipc", () => ({
  clearQueuedMessages: vi.fn(async () => {}),
  restoreAgentAtTurn: vi.fn(),
  sendAgentMessage: vi.fn(),
}));

vi.mock("./agentEventService", () => ({
  notifyMessageSent: vi.fn(),
}));

vi.mock("../stores/agentStore", () => ({
  updateAgent: vi.fn(),
}));

type MockedFn = ReturnType<typeof vi.fn>;

function userMsg(id: string, text: string, ts = 1000): ConversationMessage {
  return {
    id,
    role: "user",
    textBlocks: [text],
    toolCalls: [],
    timestamp: ts,
  };
}

function assistantMsg(
  id: string,
  text: string,
  ts = 1001,
): ConversationMessage {
  return {
    id,
    role: "assistant",
    textBlocks: [text],
    toolCalls: [],
    timestamp: ts,
  };
}

const AGENT = "agent-1";
const SESSION = "session-1";
const CLAUDE_SID = "claude-session-old";

function seedConversation(messages: ConversationMessage[]): void {
  setConversationState({
    conversations: {
      [AGENT]: {
        messages,
        model: "sonnet",
        sessionId: CLAUDE_SID,
        title: "Test convo",
      },
    },
    drafts: {},
    pendingImages: {},
  });
}

describe("editAndRestoreFromMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setConversationState({
      conversations: {},
      drafts: {},
      pendingImages: {},
    });

    (restoreAgentAtTurn as MockedFn).mockResolvedValue({
      claude_session_id: "claude-session-new",
    });
    (sendAgentMessage as MockedFn).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when the conversation is missing", async () => {
    await expect(
      editAndRestoreFromMessage(SESSION, "missing", "m1", "new"),
    ).rejects.toThrow(/Conversation not found/);
  });

  it("throws when the conversation has no Claude session id", async () => {
    setConversationState({
      conversations: {
        [AGENT]: {
          messages: [userMsg("m1", "hi")],
          model: "sonnet",
        },
      },
      drafts: {},
      pendingImages: {},
    });

    await expect(
      editAndRestoreFromMessage(SESSION, AGENT, "m1", "new"),
    ).rejects.toThrow(/missing a Claude session id/);
  });

  it("throws when the message id does not exist", async () => {
    seedConversation([userMsg("m1", "hi")]);
    await expect(
      editAndRestoreFromMessage(SESSION, AGENT, "m-missing", "new"),
    ).rejects.toThrow(/Message not found/);
  });

  it("throws when the edited message is not a user message", async () => {
    seedConversation([userMsg("m1", "hi"), assistantMsg("m2", "hello")]);
    await expect(
      editAndRestoreFromMessage(SESSION, AGENT, "m2", "new"),
    ).rejects.toThrow(/Only user messages/);
  });

  it("flips status to running + marks in-flight before the restore call", async () => {
    seedConversation([
      userMsg("m1", "first", 1000),
      assistantMsg("m2", "a1", 1001),
      userMsg("m3", "second", 2000),
    ]);

    await editAndRestoreFromMessage(SESSION, AGENT, "m3", "edited");

    const notifyOrder = (notifyMessageSent as MockedFn).mock
      .invocationCallOrder[0];
    const updateOrder = (updateAgent as MockedFn).mock.invocationCallOrder[0];
    const restoreOrder = (restoreAgentAtTurn as MockedFn).mock
      .invocationCallOrder[0];
    expect(notifyOrder).toBeLessThan(restoreOrder);
    expect(updateOrder).toBeLessThan(restoreOrder);
    expect(notifyMessageSent).toHaveBeenCalledWith(AGENT);
    expect(updateAgent).toHaveBeenCalledWith(AGENT, { status: "running" });
  });

  it("edits a later message: calls restore with the right turn count + cutoff, same agentId", async () => {
    seedConversation([
      userMsg("m1", "first", 1000),
      assistantMsg("m2", "a1", 1001),
      userMsg("m3", "second", 2000),
      assistantMsg("m4", "a2", 2001),
      userMsg("m5", "third", 3000),
    ]);

    await editAndRestoreFromMessage(SESSION, AGENT, "m3", "edited");

    // 1 user turn kept (only m1), cutoff = m3's timestamp.
    expect(restoreAgentAtTurn).toHaveBeenCalledWith(AGENT, CLAUDE_SID, 1, 2000);
    expect(sendAgentMessage).toHaveBeenCalledWith(AGENT, "edited");
  });

  it("edits the first message: sends keepTurnNumber=0 to the backend", async () => {
    // Backend handles the fresh-start case (returns null claude_session_id).
    (restoreAgentAtTurn as MockedFn).mockResolvedValueOnce({
      claude_session_id: null,
    });
    seedConversation([
      userMsg("m1", "original", 1000),
      assistantMsg("m2", "reply", 1001),
    ]);

    await editAndRestoreFromMessage(SESSION, AGENT, "m1", "edited");

    expect(restoreAgentAtTurn).toHaveBeenCalledWith(AGENT, CLAUDE_SID, 0, 1000);
    expect(sendAgentMessage).toHaveBeenCalledWith(AGENT, "edited");

    const next = getConversationState().conversations[AGENT];
    expect(next.sessionId).toBeUndefined();
  });

  it("swaps the local transcript to backfill + edited message, preserving the agentId", async () => {
    seedConversation([
      userMsg("m1", "first", 1000),
      assistantMsg("m2", "a1", 1001),
      userMsg("m3", "second", 2000),
      assistantMsg("m4", "a2", 2001),
      userMsg("m5", "third", 3000),
    ]);

    await editAndRestoreFromMessage(SESSION, AGENT, "m3", "second-edited");

    const state = getConversationState();
    // Still only one conversation, under the same agentId.
    expect(Object.keys(state.conversations)).toEqual([AGENT]);
    const next = state.conversations[AGENT];
    // Backfill = [m1, m2] + edited user message.
    expect(next.messages).toHaveLength(3);
    expect(next.messages.slice(0, 2).map((m) => m.textBlocks[0])).toEqual([
      "first",
      "a1",
    ]);
    expect(next.messages[2].textBlocks[0]).toBe("second-edited");
    expect(next.messages[2].role).toBe("user");
    expect(next.sessionId).toBe("claude-session-new");
    expect(next.title).toBe("Test convo");
    expect(next.resuming).toBe(false);
  });

  it("sends the edited message AFTER the restore resolves", async () => {
    seedConversation([
      userMsg("m1", "first", 1000),
      userMsg("m2", "second", 2000),
    ]);

    let resolveRestore: (v: {
      claude_session_id: string | null;
    }) => void = () => undefined;
    (restoreAgentAtTurn as MockedFn).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRestore = resolve;
        }),
    );

    const promise = editAndRestoreFromMessage(SESSION, AGENT, "m2", "edited");

    // Give the orchestrator time to reach the await. Restore is pending;
    // sendAgentMessage must not have been called yet.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sendAgentMessage).not.toHaveBeenCalled();

    resolveRestore({ claude_session_id: "claude-session-new" });
    await promise;

    expect(sendAgentMessage).toHaveBeenCalledWith(AGENT, "edited");
  });

  it("propagates errors from the backend restore without sending", async () => {
    (restoreAgentAtTurn as MockedFn).mockRejectedValueOnce("truncation failed");
    seedConversation([
      userMsg("m1", "first", 1000),
      userMsg("m2", "second", 2000),
    ]);

    await expect(
      editAndRestoreFromMessage(SESSION, AGENT, "m2", "edited"),
    ).rejects.toBe("truncation failed");

    expect(sendAgentMessage).not.toHaveBeenCalled();
  });
});
