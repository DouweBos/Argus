import type { RemoteMessage, RemoteTranscriptDelta } from "./protocol";
import { describe, expect, it } from "vitest";
import { applyDeltaMessages, deltaAction } from "./transcriptDelta";

function msg(id: string, text = id): RemoteMessage {
  return { id, role: "assistant", text_blocks: [text], tool_calls: [] };
}

function delta(
  revision: number,
  messages: RemoteMessage[] = [],
  removed: string[] = [],
): RemoteTranscriptDelta {
  return {
    agent_id: "a",
    epoch: "e",
    revision,
    total: 0,
    messages,
    removed_ids: removed,
    title: null,
    model: null,
    pending_tool_name: null,
    tasks: null,
    todos: null,
  };
}

describe("transcript deltas", () => {
  it("applies the next revision, drops old ones, refetches on a gap", () => {
    const cursor = { epoch: "e", revision: 3 };

    expect(deltaAction(cursor, delta(4))).toBe("apply");
    expect(deltaAction(cursor, delta(3))).toBe("drop");
    expect(deltaAction(cursor, delta(6))).toBe("refetch");
    expect(deltaAction({ epoch: "old", revision: 3 }, delta(4))).toBe(
      "refetch",
    );
    expect(deltaAction(undefined, delta(1))).toBe("refetch");
  });

  it("upserts in place, appends new ids and removes", () => {
    const a = msg("a");
    const out = applyDeltaMessages(
      [a, msg("b"), msg("c")],
      delta(4, [msg("b", "edited"), msg("d")], ["c"]),
    );

    expect(out.map((m) => m.text_blocks[0])).toEqual(["a", "edited", "d"]);
    expect(out[0]).toBe(a);
  });
});
