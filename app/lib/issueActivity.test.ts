import type { LinearComment } from "./types";
import { describe, expect, it } from "vitest";
import { ago, commentThreads } from "./issueActivity";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const DAY = 86_400_000;

function comment(
  id: string,
  at: number,
  parentId: string | null = null,
): LinearComment {
  return { id, parentId, author: id, body: id, createdAt: at };
}

describe("ago", () => {
  it("phrases ages like Linear", () => {
    expect(ago(NOW - 30_000, NOW)).toBe("just now");
    expect(ago(NOW - 3 * 3_600_000, NOW)).toBe("3h ago");
    expect(ago(NOW - 10 * DAY, NOW)).toBe("1w ago");
    expect(ago(NOW - 35 * DAY, NOW)).toBe("1mo ago");
    expect(ago(NOW - 290 * DAY, NOW)).toBe("9mo ago");
  });
});

describe("commentThreads", () => {
  it("nests replies under their comment, both oldest first", () => {
    const threads = commentThreads([
      comment("b", 3),
      comment("a", 1),
      comment("a2", 4, "a"),
      comment("a1", 2, "a"),
      comment("orphan", 5, "gone"),
    ]);
    expect(threads.map((t) => [t.root.id, t.replies.map((r) => r.id)])).toEqual(
      [
        ["a", ["a1", "a2"]],
        ["b", []],
        ["orphan", []],
      ],
    );
  });
});
