import { describe, expect, it, beforeEach, vi } from "vitest";
import { useConversationStore } from "./conversationStore";

// Mock crypto.randomUUID for deterministic IDs
vi.stubGlobal("crypto", { randomUUID: () => "test-uuid" });

describe("conversationStore", () => {
  beforeEach(() => {
    useConversationStore.setState({ conversations: {} });
  });

  it("adds a user message", () => {
    useConversationStore.getState().addUserMessage("agent-1", "hello");
    const conv = useConversationStore.getState().conversations["agent-1"];
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0].role).toBe("user");
    expect(conv.messages[0].textBlocks).toEqual(["hello"]);
  });

  it("clears a conversation", () => {
    useConversationStore.getState().addUserMessage("agent-1", "hello");
    useConversationStore.getState().clearConversation("agent-1");
    expect(
      useConversationStore.getState().conversations["agent-1"],
    ).toBeUndefined();
  });

  it("queues and dequeues messages", () => {
    useConversationStore.getState().queueMessage("agent-1", "first");
    useConversationStore.getState().queueMessage("agent-1", "second");

    const conv = useConversationStore.getState().conversations["agent-1"];
    expect(conv.queuedMessages).toHaveLength(2);

    const first = useConversationStore.getState().dequeueMessage("agent-1");
    expect(first?.text).toBe("first");

    const second = useConversationStore.getState().dequeueMessage("agent-1");
    expect(second?.text).toBe("second");

    const empty = useConversationStore.getState().dequeueMessage("agent-1");
    expect(empty).toBeUndefined();
  });

  it("migrates conversation to new agent ID", () => {
    useConversationStore.getState().addUserMessage("agent-1", "hello");
    useConversationStore
      .getState()
      .migrateConversation("agent-1", "agent-2");

    expect(
      useConversationStore.getState().conversations["agent-1"],
    ).toBeUndefined();
    const conv = useConversationStore.getState().conversations["agent-2"];
    expect(conv.messages).toHaveLength(1);
    expect(conv.resuming).toBe(true);
  });

  it("appends system init events with metadata", () => {
    useConversationStore.getState().appendEvent("agent-1", {
      type: "system",
      subtype: "init",
      model: "claude-sonnet-4-20250514",
      session_id: "sess-123",
      tools: [{ name: "Read" }, { name: "Write" }],
      slash_commands: ["/help"],
    });

    const conv = useConversationStore.getState().conversations["agent-1"];
    expect(conv.model).toBe("claude-sonnet-4-20250514");
    expect(conv.sessionId).toBe("sess-123");
    expect(conv.tools).toEqual(["Read", "Write"]);
  });

  it("appends assistant events as messages", () => {
    useConversationStore.getState().appendEvent("agent-1", {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Hello!" },
          { type: "tool_use", id: "tu-1", name: "Read", input: { path: "/" } },
        ],
        model: "claude-sonnet-4-20250514",
        usage: { input_tokens: 10, output_tokens: 20 },
      },
    });

    const conv = useConversationStore.getState().conversations["agent-1"];
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0].role).toBe("assistant");
    expect(conv.messages[0].textBlocks).toEqual(["Hello!"]);
    expect(conv.messages[0].toolCalls).toHaveLength(1);
    expect(conv.messages[0].toolCalls[0].name).toBe("Read");
  });

  it("accumulates cost from result events", () => {
    useConversationStore.getState().appendEvent("agent-1", {
      type: "result",
      subtype: "success",
      total_cost_usd: 0.05,
      duration_ms: 1000,
      usage: { input_tokens: 100, output_tokens: 200 },
    });
    useConversationStore.getState().appendEvent("agent-1", {
      type: "result",
      subtype: "success",
      total_cost_usd: 0.03,
      duration_ms: 500,
      usage: { input_tokens: 50, output_tokens: 100 },
    });

    const conv = useConversationStore.getState().conversations["agent-1"];
    expect(conv.totalCost).toBeCloseTo(0.08);
    expect(conv.totalDuration).toBe(1500);
  });

  it("suppresses events during bootstrapping except system and result", () => {
    useConversationStore.getState().setBootstrapping("agent-1", true);

    // Assistant event should be suppressed
    useConversationStore.getState().appendEvent("agent-1", {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "hidden" }],
        model: "claude-sonnet-4-20250514",
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });

    const conv = useConversationStore.getState().conversations["agent-1"];
    expect(conv.messages).toHaveLength(0);

    // Result event clears bootstrapping
    useConversationStore.getState().appendEvent("agent-1", {
      type: "result",
      subtype: "success",
      total_cost_usd: 0,
      duration_ms: 0,
      usage: { input_tokens: 0, output_tokens: 0 },
    });

    expect(
      useConversationStore.getState().conversations["agent-1"].bootstrapping,
    ).toBe(false);
  });
});
