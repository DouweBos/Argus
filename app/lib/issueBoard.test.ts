import type { LinearIssue } from "./types";
import { describe, expect, it } from "vitest";
import {
  boardColumns,
  byPriority,
  cycleLabel,
  sessionForIssue,
} from "./issueBoard";

function issue(over: Partial<LinearIssue>): LinearIssue {
  return {
    id: over.identifier ?? "id",
    identifier: "ENG-1",
    title: "t",
    description: "",
    url: "",
    branchName: "eng-1",
    state: { id: "s", name: "Todo", type: "unstarted", position: 1 },
    priority: 0,
    estimate: null,
    teamId: "t",
    teamKey: "ENG",
    teamName: "Eng",
    assignee: null,
    assigneeAvatarUrl: null,
    labels: [],
    project: null,
    cycle: null,
    parent: null,
    pullRequestCount: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe("boardColumns", () => {
  it("orders columns by how work flows, merging same-named states", () => {
    const columns = boardColumns([
      issue({
        identifier: "A",
        state: { id: "1", name: "In Review", type: "started", position: 3 },
      }),
      issue({
        identifier: "B",
        state: { id: "2", name: "Todo", type: "unstarted", position: 1 },
      }),
      issue({
        identifier: "C",
        state: { id: "3", name: "In Progress", type: "started", position: 2 },
      }),
      issue({
        identifier: "D",
        state: { id: "4", name: "todo", type: "unstarted", position: 1 },
      }),
      issue({
        identifier: "E",
        state: { id: "5", name: "Backlog", type: "backlog", position: 0 },
      }),
    ]);
    expect(columns.map((c) => c.name)).toEqual([
      "Backlog",
      "Todo",
      "In Progress",
      "In Review",
    ]);
    expect(columns[1].issues.map((i) => i.identifier)).toEqual(["B", "D"]);
  });
});

describe("byPriority", () => {
  it("puts urgent first and no priority last", () => {
    const sorted = [0, 3, 1, 4, 2]
      .map((p) => issue({ priority: p }))
      .sort(byPriority);
    expect(sorted.map((i) => i.priority)).toEqual([1, 2, 3, 4, 0]);
  });
});

describe("sessionForIssue", () => {
  it("matches a linked issue or Linear's branch name", () => {
    const linked = {
      id: "a",
      kind: "worktree",
      branch: "x",
      linked_issue: { identifier: "ENG-1" },
    };
    const byBranch = {
      id: "b",
      kind: "worktree",
      branch: "eng-2",
      linked_issue: null,
    };
    const sessions = [linked, byBranch] as never;
    expect(
      sessionForIssue({ identifier: "ENG-1", branchName: "nope" }, sessions)
        ?.id,
    ).toBe("a");
    expect(
      sessionForIssue({ identifier: "ENG-2", branchName: "eng-2" }, sessions)
        ?.id,
    ).toBe("b");
    expect(
      sessionForIssue({ identifier: "ENG-3", branchName: "eng-3" }, sessions),
    ).toBeNull();
  });
});

describe("cycleLabel", () => {
  it("prefers the cycle's name", () => {
    expect(
      cycleLabel({ id: "c", number: 59, name: null, isActive: true }),
    ).toBe("Cycle 59");
    expect(
      cycleLabel({ id: "c", number: 59, name: "Polish", isActive: true }),
    ).toBe("Polish");
  });
});
