import type { ConversationMessage } from "../../../stores/conversationStore";
import { describe, expect, it } from "vitest";
import { categorizeTools } from "../categorizeTools";

function makeMessage(toolNames: string[]): ConversationMessage {
  return {
    id: "msg-1",
    role: "assistant",
    textBlocks: [],
    timestamp: Date.now(),
    toolCalls: toolNames.map((name, i) => ({
      id: `tc-${i}`,
      name,
      input: {},
    })),
  };
}

describe("categorizeTools", () => {
  it("categorizes Read tool calls", () => {
    const result = categorizeTools([makeMessage(["Read", "Read"])]);
    expect(result.read).toBe(2);
  });

  it("categorizes search tools (Glob, Grep, LS)", () => {
    const result = categorizeTools([makeMessage(["Glob", "Grep", "LS"])]);
    expect(result.search).toBe(3);
  });

  it("categorizes edit tools (Edit, MultiEdit, Write)", () => {
    const result = categorizeTools([
      makeMessage(["Edit", "MultiEdit", "Write"]),
    ]);
    expect(result.edit).toBe(3);
  });

  it("categorizes Bash", () => {
    const result = categorizeTools([makeMessage(["Bash"])]);
    expect(result.bash).toBe(1);
  });

  it("categorizes web tools (WebSearch, WebFetch)", () => {
    const result = categorizeTools([makeMessage(["WebSearch", "WebFetch"])]);
    expect(result.web).toBe(2);
  });

  it("categorizes Agent tool", () => {
    const result = categorizeTools([makeMessage(["Agent"])]);
    expect(result.agent).toBe(1);
  });

  it("categorizes unknown tools as other", () => {
    const result = categorizeTools([
      makeMessage(["CustomTool", "AnotherTool"]),
    ]);
    expect(result.other).toBe(2);
  });

  it("handles empty message list", () => {
    const result = categorizeTools([]);
    expect(result).toEqual({
      read: 0,
      search: 0,
      edit: 0,
      bash: 0,
      web: 0,
      agent: 0,
      other: 0,
    });
  });

  it("handles multiple messages", () => {
    const result = categorizeTools([
      makeMessage(["Read", "Bash"]),
      makeMessage(["Edit", "Grep"]),
    ]);
    expect(result.read).toBe(1);
    expect(result.bash).toBe(1);
    expect(result.edit).toBe(1);
    expect(result.search).toBe(1);
  });
});
