import type { LlmStreamEvent } from "./types";
import { describe, expect, it } from "vitest";
import { emptyConversation, reduceEvent } from "./reducer";

const usage = { input_tokens: 1, output_tokens: 1 };
const assistant = (content: unknown[], parent?: string): LlmStreamEvent =>
  ({
    type: "assistant",
    message: { content, model: "m", usage },
    parent_tool_use_id: parent ?? null,
  }) as LlmStreamEvent;

describe("reduceEvent: bookkeeping", () => {
  it("adds no row for a thinking-only block", () => {
    const conv = reduceEvent(
      emptyConversation(),
      assistant([{ type: "thinking", thinking: "hmm", signature: "s" }]),
    );
    expect(conv.messages).toEqual([]);
    expect(conv.lastEventType).toBe("assistant");
    expect(conv.model).toBe("m");
  });

  it("adds no row for the synthetic no-response stub", () => {
    const conv = reduceEvent(
      emptyConversation(),
      assistant([{ type: "text", text: "No response requested." }]),
    );
    expect(conv.messages).toEqual([]);
  });

  it("still adds text and tool calls", () => {
    const conv = reduceEvent(
      emptyConversation(),
      assistant([
        { type: "text", text: "Looking." },
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
      ]),
    );
    expect(conv.messages).toHaveLength(1);
    expect(conv.pendingToolName).toBe("Bash");
  });

  it("does not nest a sub-agent's thinking as an empty tool card", () => {
    let conv = reduceEvent(
      emptyConversation(),
      assistant([
        {
          type: "tool_use",
          id: "task",
          name: "Agent",
          input: { prompt: "go" },
        },
      ]),
    );
    conv = reduceEvent(
      conv,
      assistant(
        [
          { type: "thinking", thinking: "plan", signature: "s" },
          { type: "text", text: "Reading." },
        ],
        "task",
      ),
    );
    expect(conv.messages[0].toolCalls[0].children).toEqual([
      { kind: "text", text: "Reading." },
    ]);
  });
});
