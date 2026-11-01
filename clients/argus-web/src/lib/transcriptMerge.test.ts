import { describe, expect, it } from "vitest";
import type { RemoteMessage } from "./protocol";
import {
  mergeTail,
  pendingOptimistic,
  prependOlder,
  withValue,
} from "./transcriptMerge";

function msg(
  id: string,
  text = id,
  role: RemoteMessage["role"] = "assistant",
): RemoteMessage {
  return { id, role, text_blocks: [text], tool_calls: [] };
}

describe("mergeTail", () => {
  it("keeps older pages ahead of the fresh tail", () => {
    const older = [msg("1"), msg("2"), msg("3")];
    const merged = mergeTail(older, [msg("3", "edited"), msg("4")]);

    expect(merged.map((m) => [m.id, m.text_blocks[0]])).toEqual([
      ["1", "1"],
      ["2", "2"],
      ["3", "edited"],
      ["4", "4"],
    ]);
  });

  it("returns the same array when the page changed nothing", () => {
    const existing = [msg("1"), msg("2")];

    expect(mergeTail(existing, [msg("1"), msg("2")])).toBe(existing);
  });

  it("reuses unchanged messages so their rows stay put", () => {
    const one = msg("1");
    const merged = mergeTail([one], [msg("1"), msg("2")]);

    expect(merged[0]).toBe(one);
  });

  it("starts a transcript from nothing", () => {
    expect(mergeTail(undefined, [])).toEqual([]);
  });
});

describe("pendingOptimistic", () => {
  it("drops a bubble once the host echoes it, preamble and all", () => {
    const optimistic = [msg("o1", "fix the login", "user")];
    const tail = [msg("u1", "Linked projects: …\nfix the login", "user")];

    expect(pendingOptimistic(optimistic, tail)).toEqual([]);
  });

  it("keeps a bubble the host hasn't seen, by reference", () => {
    const optimistic = [msg("o1", "still sending", "user")];

    expect(pendingOptimistic(optimistic, [msg("a1", "still sending")])).toBe(
      optimistic,
    );
  });

  it("drops a bubble with no text", () => {
    expect(pendingOptimistic([msg("o1", "  ", "user")], [])).toEqual([]);
  });
});

describe("prependOlder", () => {
  it("puts older messages first, skipping ones already shown", () => {
    const merged = prependOlder([msg("3"), msg("4")], [msg("1"), msg("3")]);

    expect(merged.map((m) => m.id)).toEqual(["1", "3", "4"]);
  });
});

describe("withValue", () => {
  it("only makes a new map when the value moved", () => {
    const map = { a: [1] };

    expect(withValue(map, "a", [1])).toBe(map);
    expect(withValue(map, "a", [2])).toEqual({ a: [2] });
    expect(withValue(map, "b", null)).toEqual({ a: [1], b: null });
  });
});
