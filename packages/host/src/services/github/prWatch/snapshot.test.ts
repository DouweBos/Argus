import type { PrSnapshot, WatchedCheck } from "./snapshot";
import { describe, expect, it } from "vitest";
import { mapCheck, toSnapshot, trimFailedLog } from "./fetch";
import {
  diffSnapshot,
  emptyMemory,
  wakeMessage,
  wakeSummary,
} from "./snapshot";

function check(overrides: Partial<WatchedCheck> = {}): WatchedCheck {
  return {
    name: "ci",
    bucket: "pending",
    required: false,
    detailsUrl: null,
    failures: [],
    ...overrides,
  };
}

function snap(overrides: Partial<PrSnapshot> = {}): PrSnapshot {
  return {
    number: 7,
    url: "https://github.com/o/r/pull/7",
    state: "OPEN",
    mergeable: "MERGEABLE",
    headOid: "a1",
    viewer: "me",
    checks: [],
    comments: [],
    ...overrides,
  };
}

const comment = (id: string, author = "alice") => ({
  id,
  author,
  kind: "comment" as const,
  body: `body ${id}`,
  url: `https://x/${id}`,
});

describe("diffSnapshot", () => {
  it("takes existing comments and green as the baseline", () => {
    const memory = emptyMemory();
    const events = diffSnapshot(
      memory,
      snap({
        checks: [check({ bucket: "pass" })],
        comments: [comment("c1")],
      }),
    );
    expect(events).toEqual([]);
  });

  it("wakes on a failure already showing at the first poll", () => {
    const events = diffSnapshot(
      emptyMemory(),
      snap({ checks: [check({ bucket: "fail" })] }),
    );
    expect(events.map((e) => e.kind)).toEqual(["check_failed"]);
  });

  it("reports each failure once per head commit", () => {
    const memory = emptyMemory();
    const failing = { checks: [check({ bucket: "fail" })] };
    expect(diffSnapshot(memory, snap(failing))).toHaveLength(1);
    expect(diffSnapshot(memory, snap(failing))).toHaveLength(0);
    expect(
      diffSnapshot(memory, snap({ ...failing, headOid: "a2" })),
    ).toHaveLength(1);
  });

  it("reports green once when pending checks finish", () => {
    const memory = emptyMemory();
    diffSnapshot(memory, snap({ checks: [check()] }));
    const events = diffSnapshot(
      memory,
      snap({ checks: [check({ bucket: "pass" })] }),
    );
    expect(events).toEqual([{ kind: "checks_passed", count: 1 }]);
    expect(
      diffSnapshot(memory, snap({ checks: [check({ bucket: "pass" })] })),
    ).toEqual([]);
  });

  it("gates green on the required checks when there are any", () => {
    const memory = emptyMemory();
    diffSnapshot(memory, snap());
    const events = diffSnapshot(
      memory,
      snap({
        checks: [
          check({ name: "build", required: true, bucket: "pass" }),
          check({ name: "slow", bucket: "pending" }),
        ],
      }),
    );
    expect(events).toEqual([{ kind: "checks_passed", count: 1 }]);
  });

  it("wakes on new comments, skipping the viewer's own", () => {
    const memory = emptyMemory();
    diffSnapshot(memory, snap({ comments: [comment("c1")] }));
    const events = diffSnapshot(
      memory,
      snap({
        comments: [comment("c1"), comment("c2"), comment("c3", "ME")],
      }),
    );
    expect(events).toEqual([{ kind: "comment", comment: comment("c2") }]);
  });

  it("reports a conflict once, and again after it was resolved", () => {
    const memory = emptyMemory();
    expect(diffSnapshot(memory, snap({ mergeable: "CONFLICTING" }))).toEqual([
      { kind: "conflict" },
    ]);
    expect(diffSnapshot(memory, snap({ mergeable: "CONFLICTING" }))).toEqual(
      [],
    );
    diffSnapshot(memory, snap({ mergeable: "MERGEABLE" }));
    expect(diffSnapshot(memory, snap({ mergeable: "CONFLICTING" }))).toEqual([
      { kind: "conflict" },
    ]);
  });
});

describe("wakeMessage", () => {
  it("carries annotations, the log tail and the comment", () => {
    const failed = check({
      name: "test",
      bucket: "fail",
      detailsUrl: "https://github.com/o/r/actions/runs/1/job/2",
      failures: ["src/a.test.ts:4 expected 1 to be 2"],
    });
    const events = [
      { kind: "check_failed" as const, check: failed },
      {
        kind: "comment" as const,
        comment: {
          ...comment("c9"),
          kind: "inline" as const,
          location: "src/a.ts:3",
        },
      },
    ];
    const message = wakeMessage(
      snap(),
      events,
      new Map([["test", "FAIL src/a.test.ts"]]),
    );
    expect(message).toContain("## Check failed: test");
    expect(message).toContain("- src/a.test.ts:4 expected 1 to be 2");
    expect(message).toContain("FAIL src/a.test.ts");
    expect(message).toContain("New review comment from @alice on src/a.ts:3");
    expect(message).toContain("> body c9");
    expect(wakeSummary(7, events)).toBe("PR #7: test failed, new comment");
  });
});

describe("fetch mapping", () => {
  it("buckets check runs and keeps only failure annotations", () => {
    expect(
      mapCheck({
        __typename: "CheckRun",
        name: "ci",
        status: "COMPLETED",
        conclusion: "FAILURE",
        isRequired: true,
        annotations: {
          nodes: [
            { annotationLevel: "WARNING", message: "node 20" },
            {
              annotationLevel: "FAILURE",
              message: "boom\n",
              path: "a.ts",
              location: { start: { line: 3 } },
            },
          ],
        },
      }),
    ).toMatchObject({
      bucket: "fail",
      required: true,
      failures: ["a.ts:3 boom"],
    });
    expect(
      mapCheck({
        __typename: "CheckRun",
        status: "COMPLETED",
        conclusion: "CANCELLED",
      })?.bucket,
    ).toBe("skip");
    expect(
      mapCheck({
        __typename: "StatusContext",
        context: "ci/x",
        state: "ERROR",
      }),
    ).toMatchObject({ name: "ci/x", bucket: "fail" });
  });

  it("flattens reviews into their inline comments", () => {
    const s = toSnapshot(
      {
        number: 1,
        url: "u",
        state: "OPEN",
        mergeable: "UNKNOWN",
        headRefOid: "h",
        commits: { nodes: [] },
        timelineItems: {
          nodes: [
            {
              __typename: "PullRequestReview",
              id: "r1",
              url: "ru",
              body: "",
              state: "CHANGES_REQUESTED",
              author: { login: "bob" },
              comments: {
                nodes: [
                  { id: "rc1", url: "rcu", body: "nit", path: "x.ts", line: 9 },
                ],
              },
            },
          ],
        },
      },
      "me",
    );
    expect(s.comments.map((c) => [c.id, c.kind, c.location])).toEqual([
      ["r1", "review", undefined],
      ["rc1", "inline", "x.ts:9"],
    ]);
  });

  it("strips job, step and timestamp prefixes from failed logs", () => {
    const raw = [
      "ci\tTest\t2026-11-09T22:14:41.8312020Z \u001b[31mFAIL\u001b[0m a.test.ts",
      "ci\tTest\t",
      "ci\tTest\t2026-11-09T22:14:41.8345580Z ##[error]Process completed with exit code 1.",
    ].join("\n");
    expect(trimFailedLog(raw)).toBe(
      "FAIL a.test.ts\n##[error]Process completed with exit code 1.",
    );
  });
});
