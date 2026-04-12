import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addUserMessage,
  appendEvent,
  clearConversation,
  dequeueMessage,
  getConversationState,
  migrateConversation,
  queueMessage,
  setCapabilities,
  setConversationState,
} from "./conversationStore";

// Mock crypto.randomUUID for deterministic IDs
vi.stubGlobal("crypto", { randomUUID: () => "test-uuid" });

describe("conversationStore", () => {
  beforeEach(() => {
    setConversationState({ conversations: {} });
  });

  it("adds a user message", () => {
    addUserMessage("agent-1", "hello");
    const conv = getConversationState().conversations["agent-1"];
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0].role).toBe("user");
    expect(conv.messages[0].textBlocks).toEqual(["hello"]);
  });

  it("clears a conversation", () => {
    addUserMessage("agent-1", "hello");
    clearConversation("agent-1");
    expect(getConversationState().conversations["agent-1"]).toBeUndefined();
  });

  it("queues and dequeues messages", () => {
    queueMessage("agent-1", "first");
    queueMessage("agent-1", "second");

    const conv = getConversationState().conversations["agent-1"];
    expect(conv.queuedMessages).toHaveLength(2);

    const first = dequeueMessage("agent-1");
    expect(first?.text).toBe("first");

    const second = dequeueMessage("agent-1");
    expect(second?.text).toBe("second");

    const empty = dequeueMessage("agent-1");
    expect(empty).toBeUndefined();
  });

  it("migrates conversation to new agent ID", () => {
    addUserMessage("agent-1", "hello");
    migrateConversation("agent-1", "agent-2");

    expect(getConversationState().conversations["agent-1"]).toBeUndefined();
    const conv = getConversationState().conversations["agent-2"];
    expect(conv.messages).toHaveLength(1);
    expect(conv.resuming).toBe(true);
  });

  it("appends system init events with metadata", () => {
    appendEvent("agent-1", {
      type: "system",
      subtype: "init",
      model: "claude-sonnet-4-20250514",
      session_id: "sess-123",
      tools: [{ name: "Read" }, { name: "Write" }],
      slash_commands: ["/help"],
    });

    const conv = getConversationState().conversations["agent-1"];
    expect(conv.model).toBe("claude-sonnet-4-20250514");
    expect(conv.sessionId).toBe("sess-123");
    expect(conv.tools).toEqual(["Read", "Write"]);
  });

  it("appends assistant events as messages", () => {
    appendEvent("agent-1", {
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

    const conv = getConversationState().conversations["agent-1"];
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0].role).toBe("assistant");
    expect(conv.messages[0].textBlocks).toEqual(["Hello!"]);
    expect(conv.messages[0].toolCalls).toHaveLength(1);
    expect(conv.messages[0].toolCalls[0].name).toBe("Read");
  });

  it("accumulates cost from result events", () => {
    appendEvent("agent-1", {
      type: "result",
      subtype: "success",
      total_cost_usd: 0.05,
      duration_ms: 1000,
      usage: { input_tokens: 100, output_tokens: 200 },
    });
    appendEvent("agent-1", {
      type: "result",
      subtype: "success",
      total_cost_usd: 0.03,
      duration_ms: 500,
      usage: { input_tokens: 50, output_tokens: 100 },
    });

    const conv = getConversationState().conversations["agent-1"];
    expect(conv.totalCost).toBeCloseTo(0.08);
    expect(conv.totalDuration).toBe(1500);
  });

  it("stores capabilities from initialize response", () => {
    const capabilities = {
      commands: [
        { name: "commit", description: "Commit changes", argumentHint: "" },
        { name: "review", description: "Review code", argumentHint: "<pr>" },
      ],
      models: [
        {
          value: "claude-sonnet-4-6",
          displayName: "Sonnet 4.6",
          description: "Fast",
        },
      ],
      agents: [{ name: "Explore", description: "Explore codebase" }],
    };

    setCapabilities("agent-1", capabilities);

    const conv = getConversationState().conversations["agent-1"];
    expect(conv.capabilities).toEqual(capabilities);
    expect(conv.slashCommands).toHaveLength(2);
    expect(conv.slashCommands![0].name).toBe("commit");
    expect(conv.slashCommands![0].description).toBe("Commit changes");
  });
});
