import type { ConversationMessage, ToolCallInfo } from "./conversationStore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addUserMessage,
  appendEvent,
  appendInjectedPrompt,
  cancelPermission,
  clearConversation,
  getConversationState,
  hasRunningSubagents,
  loadSavedMessages,
  migrateConversation,
  setCapabilities,
  setConversationState,
  setPermissionPending,
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

  it("keeps the turn a resumed agent runs for an injected prompt", () => {
    loadSavedMessages("agent-1", [], undefined, "claude-session", true);
    appendInjectedPrompt("agent-1", {
      id: "prompt",
      role: "system",
      textBlocks: ["continue"],
      toolCalls: [],
      timestamp: 0,
    });
    appendEvent("agent-1", {
      type: "assistant",
      message: { content: [{ type: "text", text: "On it" }] },
    } as Parameters<typeof appendEvent>[1]);

    const conv = getConversationState().conversations["agent-1"];
    expect(conv.resuming).toBe(false);
    expect(conv.messages.map((m) => m.textBlocks)).toEqual([
      ["continue"],
      ["On it"],
    ]);
  });

  it("clears a conversation", () => {
    addUserMessage("agent-1", "hello");
    clearConversation("agent-1");
    expect(getConversationState().conversations["agent-1"]).toBeUndefined();
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

  it("nests sub-agent text under parent tool call via parent_tool_use_id", () => {
    // Top-level Task tool call
    appendEvent("agent-1", {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "task-1",
            name: "Task",
            input: { description: "do stuff" },
          },
        ],
        model: "claude-sonnet-4-20250514",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    // Sub-agent text response
    appendEvent("agent-1", {
      type: "assistant",
      parent_tool_use_id: "task-1",
      message: {
        content: [{ type: "text", text: "exploring..." }],
        model: "claude-sonnet-4-20250514",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });

    const conv = getConversationState().conversations["agent-1"];
    expect(conv.messages).toHaveLength(1);
    const parent = conv.messages[0].toolCalls[0];
    expect(parent.children).toHaveLength(1);
    expect(parent.children![0]).toEqual({ kind: "text", text: "exploring..." });
  });

  it("nests sub-agent tool_use inside parent Task tool call", () => {
    appendEvent("agent-1", {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "task-1",
            name: "Task",
            input: {},
          },
        ],
        model: "m",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    appendEvent("agent-1", {
      type: "assistant",
      parent_tool_use_id: "task-1",
      message: {
        content: [
          {
            type: "tool_use",
            id: "read-1",
            name: "Read",
            input: { file_path: "/a" },
          },
        ],
        model: "m",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });

    const conv = getConversationState().conversations["agent-1"];
    const parent = conv.messages[0].toolCalls[0];
    expect(parent.children).toHaveLength(1);
    const child = parent.children![0];
    expect(child).toEqual({
      kind: "tool_use",
      toolCall: {
        id: "read-1",
        name: "Read",
        input: { file_path: "/a" },
      },
    });
  });

  it("matches sub-agent tool_result to nested child by tool_use_id", () => {
    appendEvent("agent-1", {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "task-1", name: "Task", input: {} }],
        model: "m",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    appendEvent("agent-1", {
      type: "assistant",
      parent_tool_use_id: "task-1",
      message: {
        content: [
          {
            type: "tool_use",
            id: "read-1",
            name: "Read",
            input: { file_path: "/a" },
          },
        ],
        model: "m",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    appendEvent("agent-1", {
      type: "user",
      parent_tool_use_id: "task-1",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "read-1",
            content: "file contents",
          },
        ],
      },
    });

    const conv = getConversationState().conversations["agent-1"];
    const parent = conv.messages[0].toolCalls[0];
    const child = parent.children![0];
    expect(child).toMatchObject({
      kind: "tool_use",
      toolCall: {
        id: "read-1",
        result: "file contents",
        isError: false,
      },
    });
  });

  it("sets pendingPermission on a nested sub-agent tool call", () => {
    appendEvent("agent-1", {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "task-1", name: "Task", input: {} }],
        model: "m",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    appendEvent("agent-1", {
      type: "assistant",
      parent_tool_use_id: "task-1",
      message: {
        content: [
          {
            type: "tool_use",
            id: "bash-1",
            name: "Bash",
            input: { command: "grep x" },
          },
        ],
        model: "m",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });

    const found = setPermissionPending("agent-1", {
      request_id: "req-1",
      tool_use_id: "bash-1",
      tool_name: "Bash",
      tool_input: { command: "grep x" },
    });
    expect(found).toBe(true);

    const conv = getConversationState().conversations["agent-1"];
    const child = conv.messages[0].toolCalls[0].children![0];
    expect(child).toMatchObject({
      kind: "tool_use",
      toolCall: { id: "bash-1", pendingPermission: true },
    });

    // Cancelling clears it on the nested child too.
    cancelPermission("agent-1", "bash-1");
    const cleared = getConversationState().conversations["agent-1"];
    expect(cleared.messages[0].toolCalls[0].children![0]).toMatchObject({
      kind: "tool_use",
      toolCall: { id: "bash-1", pendingPermission: false },
    });
  });

  it("attaches a background tool_result to an older assistant message", () => {
    // Assistant message that spawns a background Agent.
    appendEvent("agent-1", {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "agent-x", name: "Agent", input: {} },
        ],
        model: "m",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    // A later, more recent assistant turn — pushes the Agent call off "last".
    appendEvent("agent-1", {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "still working" }],
        model: "m",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    // Deferred top-level tool_result for the background Agent (no parent id).
    appendEvent("agent-1", {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "agent-x",
            content: "final report",
          },
        ],
      },
    });

    const conv = getConversationState().conversations["agent-1"];
    expect(conv.messages[0].toolCalls[0]).toMatchObject({
      id: "agent-x",
      result: "final report",
      isError: false,
    });
  });

  it("still produces top-level messages when parent_tool_use_id is absent", () => {
    appendEvent("agent-1", {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "hi" }],
        model: "m",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    const conv = getConversationState().conversations["agent-1"];
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0].textBlocks).toEqual(["hi"]);
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
      account: {},
      output_style: "default",
      available_output_styles: ["default"],
    };

    setCapabilities("agent-1", capabilities);

    const conv = getConversationState().conversations["agent-1"];
    expect(conv.capabilities).toEqual(capabilities);
    expect(conv.slashCommands).toHaveLength(2);
    expect(conv.slashCommands![0].name).toBe("commit");
    expect(conv.slashCommands![0].description).toBe("Commit changes");
  });

  describe("hasRunningSubagents", () => {
    function seed(toolCalls: ToolCallInfo[]) {
      const message: ConversationMessage = {
        id: "m1",
        role: "assistant",
        textBlocks: [],
        timestamp: 0,
        toolCalls,
      };
      setConversationState({
        conversations: {
          "agent-1": { messages: [message] },
        },
      });
    }

    it("is false with no conversation", () => {
      expect(hasRunningSubagents("agent-1")).toBe(false);
    });

    it("is true for a Task tool call without a result", () => {
      seed([{ id: "t1", name: "Task", input: {} }]);
      expect(hasRunningSubagents("agent-1")).toBe(true);
    });

    it("is true for an Agent tool call without a result", () => {
      seed([{ id: "t1", name: "Agent", input: {} }]);
      expect(hasRunningSubagents("agent-1")).toBe(true);
    });

    it("is false once the Task tool call has a result", () => {
      seed([{ id: "t1", name: "Task", input: {}, result: "done" }]);
      expect(hasRunningSubagents("agent-1")).toBe(false);
    });

    it("is false while the Task call awaits permission", () => {
      seed([{ id: "t1", name: "Task", input: {}, pendingPermission: true }]);
      expect(hasRunningSubagents("agent-1")).toBe(false);
    });

    it("ignores non-subagent tool calls", () => {
      seed([{ id: "t1", name: "Bash", input: {} }]);
      expect(hasRunningSubagents("agent-1")).toBe(false);
    });
  });
});
