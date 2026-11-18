import { describe, expect, it } from "vitest";
import { sortSessionsByRecency } from "./sessionRecency";

const s = (
  id: string,
  at?: number,
  extra: { compare?: string; parent?: string } = {},
) => ({
  id,
  last_message_at: at ?? null,
  parent_session_id: extra.parent ?? null,
  compare_group: extra.compare
    ? { id: extra.compare, slot: 0, runner_id: null, model: null, effort: null }
    : null,
});

const ids = (list: { id: string }[]) => list.map((x) => x.id);

describe("sortSessionsByRecency", () => {
  it("puts the newest first and unstamped ones last in their order", () => {
    expect(
      ids(sortSessionsByRecency([s("a"), s("old", 1), s("b"), s("new", 3)])),
    ).toEqual(["new", "old", "a", "b"]);
  });

  it("sorts a compare run by its newest slot and keeps it together", () => {
    expect(
      ids(
        sortSessionsByRecency([
          s("x", 5),
          s("slot1", 1, { compare: "r" }),
          s("y", 3),
          s("slot2", 9, { compare: "r" }),
        ]),
      ),
    ).toEqual(["slot1", "slot2", "x", "y"]);
  });

  it("sorts a stack by its newest session with the parent first", () => {
    expect(
      ids(
        sortSessionsByRecency([
          s("x", 5),
          s("parent", 1),
          s("child", 9, { parent: "parent" }),
        ]),
      ),
    ).toEqual(["parent", "child", "x"]);
  });
});
