import type { ConversationMessage } from "./types";
import { describe, expect, it } from "vitest";
import { applyMetaPatch, diffMessages, diffMeta } from "./delta";

function msg(id: string, text = id): ConversationMessage {
  return {
    id,
    role: "assistant",
    textBlocks: [text],
    toolCalls: [],
    timestamp: 0,
  };
}

describe("diffMessages", () => {
  it("is empty for the same array", () => {
    const a = [msg("a")];

    expect(diffMessages(a, a)).toEqual([]);
  });

  it("appends, updates by reference and removes from the end", () => {
    const a = msg("a");
    const b = msg("b");
    const c = msg("c");

    expect(diffMessages([a, b], [a, b, c])).toEqual([
      { op: "append", index: 2, message: c },
    ]);
    const b2 = msg("b", "edited");
    expect(diffMessages([a, b], [a, b2])).toEqual([
      { op: "update", index: 1, message: b2 },
    ]);
    expect(diffMessages([a, b, c], [a])).toEqual([
      { op: "remove", index: 2, id: "c" },
      { op: "remove", index: 1, id: "b" },
    ]);
  });
});

describe("diffMeta", () => {
  it("sends changed fields and nulls the ones that went away", () => {
    const patch = diffMeta(
      { model: "a", title: "t", pendingToolName: "Bash" },
      { model: "b", title: "t" },
    );

    expect(patch).toEqual({ model: "b", pendingToolName: null });
    expect(
      applyMetaPatch(
        { model: "a", title: "t", pendingToolName: "Bash" },
        patch!,
      ),
    ).toEqual({ model: "b", title: "t" });
  });

  it("sends a task list's map and order together", () => {
    const tasks = {};

    expect(
      diffMeta({ tasks, taskOrder: ["1"] }, { tasks, taskOrder: ["1", "2"] }),
    ).toEqual({ tasks, taskOrder: ["1", "2"] });
  });

  it("is undefined when nothing changed", () => {
    expect(diffMeta({ model: "a" }, { model: "a" })).toBeUndefined();
  });
});
