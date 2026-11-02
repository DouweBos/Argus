import type {
  LinearHistoryEvent,
  LinearWorkflowState,
} from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import {
  lastChange,
  PRIORITY_OPTIONS,
  shortDuration,
  statusOptions,
  timeInStatus,
  visibleOptions,
} from "./issueProperty";

// Vectors shared with ArgusCore's LinearIssuePropertyTests.
const DAY = 86_400_000;

function state(
  id: string,
  type: string,
  position: number,
): LinearWorkflowState {
  return { id, name: id, type, position };
}

describe("issue properties", () => {
  it("sums each status's time, including returns to it", () => {
    const stints = timeInStatus(
      [
        { name: "Triage", type: "triage", enteredAt: 0 },
        { name: "Todo", type: "unstarted", enteredAt: 5 * DAY },
        { name: "In Progress", type: "started", enteredAt: 7 * DAY },
        { name: "Todo", type: "unstarted", enteredAt: 8 * DAY },
      ],
      10 * DAY,
    );
    expect(stints.map((s) => s.name)).toEqual([
      "Triage",
      "Todo",
      "In Progress",
    ]);
    expect(stints.map((s) => s.duration / DAY)).toEqual([5, 4, 1]);
  });

  it("uses Linear's short units", () => {
    expect(shortDuration(5 * DAY)).toBe("5d");
    expect(shortDuration(300 * DAY)).toBe("10mo");
    expect(shortDuration(30_000)).toBe("<1m");
  });

  it("keys statuses 1 to 9, then 0, then not at all", () => {
    const states = Array.from({ length: 12 }, (_, i) =>
      state(`s${i}`, "unstarted", i),
    );
    expect(statusOptions(states).map((o) => o.key)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "0",
      null,
      null,
    ]);
  });

  it("orders statuses by the workflow, not the team's raw order", () => {
    const states = [
      state("Done", "completed", 1),
      state("Ready for QA", "completed", 0),
      state("In Review", "started", 3),
      state("Todo", "unstarted", 0),
      state("Backlog", "backlog", 0),
      state("Triage", "triage", 0),
    ];
    expect(statusOptions(states).map((o) => o.title)).toEqual([
      "Triage",
      "Backlog",
      "Todo",
      "In Review",
      "Ready for QA",
      "Done",
    ]);
  });

  it("runs priorities urgent to low, then none, keyed by their number", () => {
    expect(PRIORITY_OPTIONS.map((o) => o.title)).toEqual([
      "Urgent",
      "High",
      "Medium",
      "Low",
      "No priority",
    ]);
    expect(PRIORITY_OPTIONS.map((o) => o.key)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "0",
    ]);
  });

  it("takes the newest change of a kind", () => {
    const history: LinearHistoryEvent[] = [
      {
        id: "b",
        createdAt: 3,
        actor: "bob",
        kind: "priority",
        text: "p",
        actorAvatarUrl: null,
      },
      {
        id: "a",
        createdAt: 1,
        actor: "ann",
        kind: "priority",
        text: "p",
        actorAvatarUrl: null,
      },
      {
        id: "c",
        createdAt: 5,
        actor: "cy",
        kind: "status",
        text: "s",
        actorAvatarUrl: null,
      },
    ];
    expect(lastChange(history, "priority")?.id).toBe("b");
    expect(lastChange(history, "assignee")).toBeNull();
    expect(lastChange(null, "cycle")).toBeNull();
  });

  it("filters options by what's typed", () => {
    expect(visibleOptions(PRIORITY_OPTIONS, "ur").map((o) => o.id)).toEqual([
      "1",
    ]);
    expect(visibleOptions(PRIORITY_OPTIONS, " ")).toHaveLength(5);
  });
});
