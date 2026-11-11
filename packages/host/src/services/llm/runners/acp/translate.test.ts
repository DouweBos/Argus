import { describe, expect, it } from "vitest";
import { AcpTranscript, toolUses } from "./translate";

const parse = (lines: string[]) =>
  lines.map((l) => JSON.parse(l) as Record<string, unknown>);

function transcript() {
  const t = new AcpTranscript();
  t.init("s-1", "m", "auto");
  t.turnStarted();

  return t;
}

describe("toolUses", () => {
  it("draws commands as Bash, diffs as Edit or Write, reads as Read", () => {
    expect(
      toolUses({
        toolCallId: "1",
        kind: "execute",
        title: "List files",
        rawInput: { command: "ls" },
      }),
    ).toEqual([
      {
        id: "1",
        name: "Bash",
        input: { command: "ls", description: "List files" },
      },
    ]);
    expect(
      toolUses({
        toolCallId: "2",
        kind: "edit",
        content: [
          { type: "diff", path: "/a", oldText: "x", newText: "y" },
          { type: "diff", path: "/b", newText: "new" },
        ],
      }),
    ).toEqual([
      {
        id: "2:0",
        name: "Edit",
        input: { file_path: "/a", old_string: "x", new_string: "y" },
      },
      { id: "2:1", name: "Write", input: { file_path: "/b", content: "new" } },
    ]);
    expect(
      toolUses({ toolCallId: "3", kind: "read", locations: [{ path: "/c" }] }),
    ).toEqual([{ id: "3", name: "Read", input: { file_path: "/c" } }]);
  });

  it("names an unknown tool after its title, keeping its raw input", () => {
    expect(
      toolUses({
        toolCallId: "4",
        kind: "other",
        title: "list_sessions",
        rawInput: { a: 1 },
      }),
    ).toEqual([{ id: "4", name: "list_sessions", input: { a: 1 } }]);
  });
});

describe("acpTranscript", () => {
  it("closes thinking before text and text before a tool card", () => {
    const t = transcript();
    const out = parse([
      ...t.update({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "hmm" },
      }),
      ...t.update({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Looking" },
      }),
      ...t.update({
        sessionUpdate: "tool_call",
        toolCallId: "t",
        kind: "read",
        title: "Read",
        locations: [{ path: "/x" }],
        status: "pending",
      }),
      ...t.update({
        sessionUpdate: "tool_call_update",
        toolCallId: "t",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "body" } }],
      }),
    ]);
    const kinds = out.map((l) => {
      const m = l.message as { content: { type: string }[] } | undefined;

      return `${l.type}:${m?.content[0]?.type}`;
    });
    expect(kinds).toEqual([
      "assistant:thinking",
      "assistant:text",
      "assistant:tool_use",
      "user:tool_result",
    ]);
    expect(JSON.stringify(out[3])).toContain("body");
  });

  it("holds an edit's card until its diff arrives", () => {
    const t = transcript();
    expect(
      t.update({ sessionUpdate: "tool_call", toolCallId: "e", kind: "edit" }),
    ).toEqual([]);
    const drawn = parse(
      t.update({
        sessionUpdate: "tool_call_update",
        toolCallId: "e",
        content: [{ type: "diff", path: "/a", oldText: "1", newText: "2" }],
      }),
    );
    expect(JSON.stringify(drawn)).toContain('"name":"Edit"');
  });

  it("turns a plan into TodoWrite and a stop into a result with usage", () => {
    const t = transcript();
    const plan = parse(
      t.update({
        sessionUpdate: "plan",
        entries: [{ content: "Do it", status: "in_progress" }],
      }),
    );
    expect(JSON.stringify(plan[0])).toContain('"name":"TodoWrite"');
    t.update({ sessionUpdate: "usage_update", used: 10, size: 1000 });
    const end = parse(
      t.turnCompleted(
        {
          stopReason: "end_turn",
          usage: { inputTokens: 50, outputTokens: 5, cachedReadTokens: 20 },
        },
        null,
      ),
    );
    expect(end[0]).toMatchObject({
      type: "result",
      subtype: "success",
      usage: {
        input_tokens: 30,
        cache_read_input_tokens: 20,
        output_tokens: 5,
      },
      modelUsage: { m: { contextWindow: 1000 } },
    });
    expect(end[1]).toMatchObject({ subtype: "session_state_changed" });
    expect(end[0]).not.toHaveProperty("total_cost_usd");
  });

  it("reports each turn's share of the session's running cost", () => {
    const t = transcript();
    const cost = (amount: number) =>
      t.update({
        sessionUpdate: "usage_update",
        cost: { amount, currency: "USD" },
      });
    const end = () =>
      parse(t.turnCompleted({ stopReason: "end_turn" }, null))[0];
    cost(0.25);
    expect(end()).toMatchObject({ total_cost_usd: 0.25 });
    cost(0.4);
    expect(end().total_cost_usd).toBeCloseTo(0.15);
    expect(end()).toMatchObject({ total_cost_usd: 0 });
  });

  it("closes calls still open when the turn ends", () => {
    const t = transcript();
    t.update({
      sessionUpdate: "tool_call",
      toolCallId: "x",
      kind: "execute",
      title: "sleep",
    });
    const end = parse(t.turnCompleted({ stopReason: "cancelled" }, null));
    expect(end[0]).toMatchObject({ type: "user" });
    expect(end[1]).toMatchObject({
      type: "result",
      subtype: "error_during_execution",
      is_error: false,
    });
  });
});
