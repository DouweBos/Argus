import type { ConversationMessage, ToolCallInfo } from "./types";
import { describe, expect, it } from "vitest";
import { UNANSWERED_RESULT } from "./prompts";
import {
  INTERRUPTED_RESULT,
  visibleMessage,
  visibleMessages,
} from "./visibility";

const msg = (over: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id: "m",
  role: "assistant",
  textBlocks: [],
  toolCalls: [],
  timestamp: 0,
  ...over,
});

const call = (over: Partial<ToolCallInfo> = {}): ToolCallInfo => ({
  id: "t",
  name: "Bash",
  input: { command: "ls" },
  result: "ok",
  ...over,
});

// Distilled from a real transcript: 504 of 1,443 messages were thinking-only,
// and ToolSearch loading deferred tools rendered as empty cards.
const toolSearch = call({
  id: "ts",
  name: "ToolSearch",
  input: { query: "select:ExitPlanMode", max_results: 1 },
  result: [{ type: "text", text: "ExitPlanMode" }],
});

describe("visibleMessage", () => {
  it("hides a thinking-only assistant turn", () => {
    expect(visibleMessage(msg({ textBlocks: ["", "  \n"] }))).toBeNull();
  });

  it("hides the synthetic no-response stub", () => {
    expect(
      visibleMessage(msg({ textBlocks: ["No response requested."] })),
    ).toBeNull();
  });

  it("hides a message whose only call is ToolSearch", () => {
    expect(visibleMessage(msg({ toolCalls: [toolSearch] }))).toBeNull();
  });

  it("strips ToolSearch beside real calls", () => {
    const bash = call();
    expect(
      visibleMessage(msg({ toolCalls: [toolSearch, bash] }))?.toolCalls,
    ).toEqual([bash]);
  });

  it("keeps a ToolSearch awaiting permission", () => {
    const pending = { ...toolSearch, pendingPermission: true };
    expect(visibleMessage(msg({ toolCalls: [pending] }))?.toolCalls).toEqual([
      pending,
    ]);
  });

  it("returns the same object when nothing is hidden", () => {
    const m = msg({ textBlocks: ["Done."], toolCalls: [call()] });
    expect(visibleMessage(m)).toBe(m);
  });

  it("keeps calls with an empty input", () => {
    const m = msg({ toolCalls: [call({ name: "ListAgents", input: {} })] });
    expect(visibleMessage(m)).toBe(m);
  });

  it("drops nameless and blank sub-agent children", () => {
    const read = call({ id: "r", name: "Read" });
    const agent = call({
      name: "Agent",
      children: [
        { kind: "tool_use", toolCall: { id: "", name: "", input: {} } },
        { kind: "text", text: " " },
        { kind: "tool_use", toolCall: toolSearch },
        { kind: "tool_use", toolCall: read },
        { kind: "text", text: "Found it." },
      ],
    });
    expect(
      visibleMessage(msg({ toolCalls: [agent] }))?.toolCalls[0].children,
    ).toEqual([
      { kind: "tool_use", toolCall: read },
      { kind: "text", text: "Found it." },
    ]);
  });

  it("keeps user messages with only images", () => {
    const m = msg({
      role: "user",
      textBlocks: [""],
      images: [{ data: "x", media_type: "image/png" }],
    });
    expect(visibleMessage(m)).toBe(m);
  });

  it("marks result-less calls interrupted once the agent is gone", () => {
    const running = call({ result: undefined });
    const m = msg({ toolCalls: [running] });
    expect(visibleMessage(m)).toBe(m);
    expect(visibleMessage(m, { settled: true })?.toolCalls[0]).toMatchObject({
      result: INTERRUPTED_RESULT,
      isError: true,
    });
  });

  it("settles a prompt nobody is left to answer as not answered", () => {
    const m = msg({
      toolCalls: [
        call({ result: undefined, pendingPermission: true }),
        call({ id: "q", name: "AskUserQuestion", result: undefined }),
      ],
    });
    for (const tc of visibleMessage(m, { settled: true })!.toolCalls) {
      expect(tc).toMatchObject({
        pendingPermission: false,
        result: UNANSWERED_RESULT,
        isError: false,
        expired: true,
      });
    }
  });
});

describe("visibleMessages", () => {
  it("returns the same array when nothing is hidden", () => {
    const list = [msg({ textBlocks: ["hi"] })];
    expect(visibleMessages(list)).toBe(list);
  });

  it("filters and hands back stable copies across calls", () => {
    const stripped = msg({ id: "a", toolCalls: [toolSearch, call()] });
    const list = [
      msg({ id: "x" }),
      stripped,
      msg({ id: "b", textBlocks: ["ok"] }),
    ];
    const first = visibleMessages(list);
    expect(first.map((m) => m.id)).toEqual(["a", "b"]);
    expect(visibleMessages([...list])[0]).toBe(first[0]);
  });
});
