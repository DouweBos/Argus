import type { LinearIssue } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import {
  applyFilters,
  filterOperator,
  filterOptions,
  filterSummary,
  flipFilter,
  optionLabel,
  toggleFilterValue,
  updateIssueFilter,
} from "./issueFilters";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function issue(over: Partial<LinearIssue>): LinearIssue {
  return {
    id: over.identifier ?? "id",
    identifier: "ENG-1",
    title: "Fix login",
    description: "",
    url: "",
    branchName: "eng-1",
    state: { id: "s", name: "Todo", type: "unstarted", position: 1 },
    priority: 0,
    estimate: null,
    teamId: "t",
    teamKey: "ENG",
    teamName: "Engineering",
    assignee: null,
    assigneeAvatarUrl: null,
    creator: null,
    dueDate: null,
    labels: [],
    project: null,
    cycle: null,
    parent: null,
    pullRequestCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

const issues = [
  issue({
    identifier: "A",
    priority: 1,
    labels: ["Bug", "iOS"],
    cycle: { id: "c", number: 59, name: null, isActive: true },
  }),
  issue({
    identifier: "B",
    priority: 2,
    labels: ["Bug"],
    cycle: { id: "d", number: 58, name: null, isActive: false },
  }),
  issue({
    identifier: "C",
    priority: 2,
    title: "Casting crash",
    createdAt: NOW - 40 * DAY,
  }),
];

describe("applyFilters", () => {
  it("matches any value within a filter and every filter", () => {
    const ids = (f: Parameters<typeof applyFilters>[1]) =>
      applyFilters(issues, f, NOW).map((i) => i.identifier);
    expect(
      ids([{ field: "priority", negate: false, values: ["1", "2"] }]),
    ).toEqual(["A", "B", "C"]);
    expect(
      ids([
        { field: "priority", negate: false, values: ["2"] },
        { field: "labels", negate: false, values: ["Bug"] },
      ]),
    ).toEqual(["B"]);
    expect(ids([{ field: "labels", negate: true, values: ["Bug"] }])).toEqual([
      "C",
    ]);
    expect(
      ids([{ field: "cycle", negate: false, values: ["current"] }]),
    ).toEqual(["A"]);
    expect(
      ids([{ field: "content", negate: false, values: ["casting"] }]),
    ).toEqual(["C"]);
    expect(ids([{ field: "created", negate: false, values: ["30d"] }])).toEqual(
      ["A", "B"],
    );
  });
});

describe("filterOptions", () => {
  it("counts each option and lists fixed ones first", () => {
    const cycle = filterOptions("cycle", issues, NOW);
    expect(cycle.map((o) => [o.label, o.count])).toEqual([
      ["Current cycle", 1],
      ["Cycle 58", 1],
      ["Cycle 59", 1],
      ["No cycle", 1],
    ]);
    expect(filterOptions("priority", issues, NOW).map((o) => o.count)).toEqual([
      1, 2, 0, 0, 0,
    ]);
  });

  it("names the empty option after the field", () => {
    expect(optionLabel("labels", "__none__")).toBe("No labels");
  });
});

describe("updateIssueFilter", () => {
  it("adds new filters last, keeps changed ones in place, and reports the change", () => {
    let row = toggleFilterValue([], "priority", "1");
    expect(row.change).toBe("add");
    row = toggleFilterValue(row.filters, "labels", "bug");
    row = toggleFilterValue(row.filters, "priority", "2");
    expect(row.change).toBeNull();
    expect(row.filters.map((f) => f.field)).toEqual(["priority", "labels"]);
    row = flipFilter(row.filters, "priority");
    expect(row.change).toBe("flip");
    expect(filterOperator(row.filters[0])).toBe("is not");
    row = updateIssueFilter(row.filters, "labels", () => null);
    expect(row.change).toBe("remove");
    expect(row.filters.map((f) => f.field)).toEqual(["priority"]);
  });

  it("summarises chips", () => {
    expect(
      filterSummary({ field: "priority", negate: false, values: ["1", "2"] }),
    ).toBe("Urgent, High");
    expect(
      filterSummary({
        field: "priority",
        negate: false,
        values: ["1", "2", "3"],
      }),
    ).toBe("3 priority");
    expect(
      filterOperator({ field: "content", negate: true, values: ["x"] }),
    ).toBe("doesn't contain");
  });
});
