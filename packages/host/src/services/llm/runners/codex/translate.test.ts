import type { CodexThreadItem } from "./protocol";
import { describe, expect, it } from "vitest";
import {
  emptyConversation,
  reduceEvent,
} from "../../../agent/conversation/reducer";
import { CodexTranscript, fileChangeTool, splitDiff } from "./translate";

const parse = (lines: string[]) => lines.map((l) => JSON.parse(l));

function fold(lines: string[]) {
  return lines.reduce(
    (c, l) => reduceEvent(c, JSON.parse(l)),
    emptyConversation(),
  );
}

describe("codexTranscript", () => {
  it("draws a command as a Bash card with its output", () => {
    const t = new CodexTranscript();
    const item: CodexThreadItem = {
      type: "commandExecution",
      id: "cmd-1",
      command: "ls",
      cwd: "/repo",
      status: "inProgress",
      aggregatedOutput: null,
      exitCode: null,
    };
    const lines = [
      ...t.init("thread-1", "gpt-5.5", "auto"),
      ...t.turnStarted(),
      ...t.itemStarted(item),
      ...t.itemCompleted({
        ...item,
        status: "completed",
        aggregatedOutput: "README.md\n",
        exitCode: 0,
      }),
      ...t.itemCompleted({ type: "agentMessage", id: "m-1", text: "Done." }),
    ];
    const convo = fold(lines);

    expect(convo.sessionId).toBe("thread-1");
    expect(convo.model).toBe("gpt-5.5");
    const call = convo.messages[0]!.toolCalls[0]!;
    expect(call.name).toBe("Bash");
    expect(call.input).toEqual({ command: "ls" });
    expect(call.isError).toBe(false);
    expect(convo.messages[1]!.textBlocks).toEqual(["Done."]);
  });

  it("marks a failing command as an error", () => {
    const t = new CodexTranscript("thread-1");
    const [result] = parse(
      t.itemCompleted({
        type: "commandExecution",
        id: "cmd-1",
        command: "false",
        cwd: "/repo",
        status: "failed",
        aggregatedOutput: "",
        exitCode: 1,
      }),
    );

    expect(result.message.content[0].is_error).toBe(true);
  });

  it("ends a turn with a result carrying the turn's usage and the context window", () => {
    const t = new CodexTranscript();
    t.init("thread-1", "gpt-5.5", "auto");
    t.tokenUsage({
      total: usage(1000, 0, 50),
      last: usage(1000, 0, 50),
      modelContextWindow: 272_000,
    });
    t.turnStarted();
    t.tokenUsage({
      total: usage(5000, 1000, 200),
      last: usage(3000, 1000, 100),
      modelContextWindow: 272_000,
    });
    t.itemCompleted({ type: "agentMessage", id: "m", text: "All set" });
    const [result, idle] = parse(
      t.turnCompleted({
        id: "turn-1",
        status: "completed",
        error: null,
        durationMs: 1234,
      }),
    );

    expect(result).toMatchObject({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "All set",
      duration_ms: 1234,
      usage: {
        input_tokens: 3000,
        cache_read_input_tokens: 1000,
        output_tokens: 150,
      },
      modelUsage: { "gpt-5.5": { contextWindow: 272_000 } },
    });
    expect(result).not.toHaveProperty("total_cost_usd");
    expect(idle).toMatchObject({
      subtype: "session_state_changed",
      state: "idle",
    });
  });

  it("reports an interrupted turn without calling it an error", () => {
    const t = new CodexTranscript("thread-1");
    const [result] = parse(
      t.turnCompleted({
        id: "turn-1",
        status: "interrupted",
        error: null,
        durationMs: 10,
      }),
    );

    expect(result.subtype).toBe("error_during_execution");
    expect(result.is_error).toBe(false);
  });

  it("turns a plan update into todos", () => {
    const t = new CodexTranscript("thread-1");
    const convo = fold(
      t.planUpdated([
        { step: "Read the code", status: "completed" },
        { step: "Write the runner", status: "inProgress" },
      ]),
    );

    expect(convo.todos).toEqual([
      {
        content: "Read the code",
        activeForm: "Read the code",
        status: "completed",
      },
      {
        content: "Write the runner",
        activeForm: "Write the runner",
        status: "in_progress",
      },
    ]);
  });

  it("names MCP calls the way Claude Code does", () => {
    const t = new CodexTranscript("thread-1");
    const [line] = parse(
      t.itemStarted({
        type: "mcpToolCall",
        id: "mcp-1",
        server: "argus",
        tool: "list_agents",
        status: "inProgress",
        arguments: { project_path: "/repo" },
        result: null,
        error: null,
      }),
    );

    expect(line.message.content[0]).toMatchObject({
      name: "mcp__argus__list_agents",
      input: { project_path: "/repo" },
    });
  });

  it("gives each file of a multi-file patch its own card", () => {
    const t = new CodexTranscript("thread-1");
    const [line] = parse(
      t.itemStarted({
        type: "fileChange",
        id: "patch-1",
        status: "inProgress",
        changes: [
          { path: "a.ts", kind: { type: "add" }, diff: "export {};\n" },
          { path: "b.ts", kind: { type: "delete" }, diff: "" },
        ],
      }),
    );

    expect(
      line.message.content.map((b: { id: string; name: string }) => [
        b.id,
        b.name,
      ]),
    ).toEqual([
      ["patch-1:0", "Write"],
      ["patch-1:1", "Delete"],
    ]);
  });
});

describe("fileChangeTool", () => {
  it("turns an update diff into an Edit", () => {
    const tool = fileChangeTool({
      path: "src/a.ts",
      kind: { type: "update", move_path: null },
      diff: "@@ -1,3 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n const c = 4;\n",
    });

    expect(tool).toEqual({
      name: "Edit",
      input: {
        file_path: "src/a.ts",
        old_string: "const a = 1;\nconst b = 2;\nconst c = 4;",
        new_string: "const a = 1;\nconst b = 3;\nconst c = 4;",
      },
    });
  });

  it("points a move at its destination", () => {
    const tool = fileChangeTool({
      path: "old.ts",
      kind: { type: "update", move_path: "new.ts" },
      diff: "@@ -1 +1 @@\n-a\n+b\n",
    });

    expect(tool.input.file_path).toBe("new.ts");
  });
});

describe("splitDiff", () => {
  it("returns null for plain content", () => {
    expect(splitDiff("hello\n")).toEqual({ removed: null, added: null });
  });

  it("separates hunks", () => {
    expect(splitDiff("@@ -1 +1 @@\n-a\n+b\n@@ -9 +9 @@\n-y\n+z\n").added).toBe(
      "b\n\nz",
    );
  });
});

function usage(input: number, cached: number, output: number) {
  return {
    totalTokens: input + output,
    inputTokens: input,
    cachedInputTokens: cached,
    cacheWriteInputTokens: 0,
    outputTokens: output,
    reasoningOutputTokens: 0,
  };
}
