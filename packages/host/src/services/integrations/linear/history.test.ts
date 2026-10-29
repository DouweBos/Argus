import { describe, expect, it } from "vitest";
import { historyEvents } from "./history";

const base = { id: "h", createdAt: "2026-10-01T10:00:00Z" };

describe("historyEvents", () => {
  it("phrases each change like Linear's activity feed", () => {
    const events = historyEvents(
      {
        ...base,
        actor: { displayName: "jillian.broek" },
        fromPriority: 0,
        toPriority: 2,
        toEstimate: 3,
        addedLabels: [{ name: "GROW" }],
      },
      "tShirt",
    );
    expect(events.map((e) => [e.kind, e.text])).toEqual([
      ["priority", "set priority to High"],
      ["estimate", "set the estimate to M"],
      ["labels", "added the label GROW"],
    ]);
    expect(events[0].actor).toBe("jillian.broek");
  });

  it("leaves the actor empty when Linear moved the issue itself", () => {
    const [event] = historyEvents(
      { ...base, fromCycle: { number: 57 }, toCycle: { number: 59 } },
      null,
    );
    expect(event).toMatchObject({
      actor: null,
      kind: "cycle",
      text: "moved the issue from Cycle 57 to Cycle 59",
    });
  });

  it("names linked pull requests and status moves", () => {
    expect(
      historyEvents(
        {
          ...base,
          attachment: { title: "chore(deps): Upgrade Kochava" },
          fromState: { name: "Todo" },
          toState: { name: "In Progress" },
        },
        null,
      ).map((e) => e.text),
    ).toEqual([
      "changed status from Todo to In Progress",
      "linked chore(deps): Upgrade Kochava",
    ]);
  });
});
