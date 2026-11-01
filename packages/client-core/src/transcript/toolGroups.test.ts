import type { RemoteMessage } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import { categorizeTools, groupRuns, groupTurns } from "./toolGroups";

// Same cases as ArgusKit's ToolGroupsTests.
function message(
  id: string,
  text: string[] = [],
  tools: string[] = [],
): RemoteMessage {
  return {
    id,
    role: "assistant",
    text_blocks: text,
    tool_calls: tools.map((name, i) => ({
      id: `${id}-${i}`,
      name,
      input: {},
      result_blocks: [],
      status: "done",
    })),
  };
}

const user = (id: string): RemoteMessage => ({
  id,
  role: "user",
  text_blocks: ["do it"],
  tool_calls: [],
});

const ids = (segments: { id: string }[]) => segments.map((s) => s.id);

describe("groupTurns", () => {
  it("folds the work and keeps the reply", () => {
    const segments = groupTurns([
      user("u"),
      message("1", ["Let me look"]),
      message("2", [], ["Read"]),
      message("3", [], ["Edit"]),
      message("r", ["Done"]),
    ]);
    expect(ids(segments)).toEqual(["u", "group-1", "r"]);
    const work = segments[1];
    expect(work.kind === "collapsed" && ids(work.messages)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("leaves text-only turns alone", () => {
    expect(
      ids(
        groupTurns([user("u"), message("1", ["Hi"]), message("2", ["There"])]),
      ),
    ).toEqual(["u", "1", "2"]);
  });

  it("keeps errors and decisions open", () => {
    const pending = message("p", [], ["Bash"]);
    pending.tool_calls[0].status = "pending";
    const error = { ...message("e", ["boom"]), is_error: true };
    expect(
      ids(
        groupTurns([
          user("u"),
          message("1", [], ["Read"]),
          error,
          message("2", [], ["Bash"]),
          pending,
        ]),
      ),
    ).toEqual(["u", "group-1", "e", "group-2", "p"]);
  });

  it("folds a running turn whole", () => {
    expect(
      ids(
        groupTurns([
          user("u"),
          message("1", [], ["Read"]),
          user("v"),
          message("2", ["Ok"]),
          message("3", [], ["Bash"]),
        ]),
      ),
    ).toEqual(["u", "group-1", "v", "group-2"]);
  });
});

describe("groupRuns", () => {
  it("drops messages with nothing to show", () => {
    expect(
      ids(groupRuns([message("a", ["hi"]), message("b", ["  "])])),
    ).toEqual(["a"]);
  });

  it("never folds a call awaiting approval", () => {
    const pending = message("2", [], ["Bash"]);
    pending.tool_calls[0].status = "pending";
    expect(
      ids(
        groupRuns([
          message("1", [], ["Bash"]),
          pending,
          message("3", [], ["Bash"]),
          message("4", [], ["Bash"]),
        ]),
      ),
    ).toEqual(["1", "2", "group-3"]);
  });

  it("folds a pair but leaves a lone call", () => {
    expect(
      ids(
        groupRuns([
          message("1", [], ["Bash"]),
          message("2", [], ["Read"]),
          message("t", ["done"]),
          message("3", [], ["Bash"]),
        ]),
      ),
    ).toEqual(["group-1", "t", "3"]);
  });

  it("never folds a push notification", () => {
    expect(
      ids(
        groupRuns([
          message("1", [], ["Bash"]),
          message("2", [], ["mcp__argus__push_notification"]),
          message("3", [], ["Bash"]),
        ]),
      ),
    ).toEqual(["1", "2", "3"]);
  });

  it("hoists image reads only when they show open", () => {
    const image = message("2", [], ["Read"]);
    image.tool_calls[0].result_blocks = [
      { type: "image", image_id: "img", media_type: "image/png" },
    ];
    const run = [message("1", [], ["Bash"]), image, message("3", [], ["Bash"])];
    expect(ids(groupRuns(run))).toEqual(["group-1"]);
    expect(ids(groupRuns(run, true))).toEqual(["1", "2", "3"]);
  });

  it("doesn't let empty messages split a run", () => {
    expect(
      ids(
        groupRuns([
          message("1", [], ["Bash"]),
          message("e1"),
          message("2", [], ["Bash"]),
          message("e2"),
          message("3", [], ["Bash"]),
        ]),
      ),
    ).toEqual(["group-1"]);
  });
});

describe("categorizeTools", () => {
  it("counts in first-seen order", () => {
    expect(
      categorizeTools([
        message("1", [], ["Bash", "Read"]),
        message("2", [], ["Grep", "Bash"]),
      ]),
    ).toEqual([
      ["bash", 2],
      ["read", 1],
      ["search", 1],
    ]);
  });
});
