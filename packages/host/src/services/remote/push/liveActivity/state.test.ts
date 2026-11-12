import type { ActivityAgent } from "./state";
import { describe, expect, it } from "vitest";
import {
  isSettled,
  OUTCOME_LINGER_MS,
  phaseOf,
  snapshotOf,
  stepSummary,
} from "./state";

const NOW = 10_000_000;

function agent(id: string, patch: Partial<ActivityAgent> = {}): ActivityAgent {
  return {
    id,
    sessionId: "s1",
    title: `Agent ${id}`,
    project: "argus",
    state: "working",
    startedAt: NOW - 60_000,
    endedAt: null,
    step: null,
    prompt: null,
    ...patch,
  };
}

describe("snapshotOf", () => {
  it("puts waiting agents first, then running, then the latest outcome", () => {
    const snapshot = snapshotOf(
      [
        agent("done-old", { state: "done", endedAt: NOW - 120_000 }),
        agent("working"),
        agent("failed", { state: "failed", endedAt: NOW - 1_000 }),
        agent("waiting", { state: "needsYou" }),
      ],
      NOW,
      4,
    );

    expect(snapshot.agents.map((a) => a.id)).toEqual([
      "waiting",
      "working",
      "failed",
      "done-old",
    ]);
    expect(phaseOf(snapshot)).toBe("needsYou");
  });

  it("drops outcomes past the linger window and counts the cut", () => {
    const snapshot = snapshotOf(
      [
        agent("a"),
        agent("b"),
        agent("c"),
        agent("d"),
        agent("gone", { state: "done", endedAt: NOW - OUTCOME_LINGER_MS }),
      ],
      NOW,
    );

    expect(snapshot.agents).toHaveLength(3);
    expect(snapshot.more).toBe(1);
  });

  it("clips free text so the sealed payload stays small", () => {
    const [clipped] = snapshotOf(
      [agent("a", { title: "x".repeat(200), step: "  Bash   ls\n -la " })],
      NOW,
    ).agents;

    expect(clipped!.title).toHaveLength(60);
    expect(clipped!.title.endsWith("…")).toBe(true);
    expect(clipped!.step).toBe("Bash ls -la");
  });

  it("is settled only once nothing runs or waits", () => {
    expect(isSettled(snapshotOf([agent("a")], NOW))).toBe(false);
    expect(
      isSettled(snapshotOf([agent("a", { state: "done", endedAt: NOW })], NOW)),
    ).toBe(true);
    expect(phaseOf(snapshotOf([], NOW))).toBe("done");
  });
});

describe("stepSummary", () => {
  it("names the file by its basename, or the command", () => {
    expect(stepSummary("Edit", { file_path: "/a/b/Foo.swift" })).toBe(
      "Edit Foo.swift",
    );
    expect(stepSummary("Bash", { command: "pnpm test" })).toBe(
      "Bash pnpm test",
    );
    expect(stepSummary("TodoWrite", {})).toBe("TodoWrite");
  });
});
