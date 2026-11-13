import type { BranchMrNode } from "./mergeRequests";
import type { MrDetailNode } from "./mrDetail";
import { describe, expect, it } from "vitest";
import {
  checksGreen,
  diffSnapshot,
  emptyMemory,
} from "../github/prWatch/snapshot";
import { jobCheck, jobsClean, trimJobTrace, watchedJob } from "./jobs";
import { buildBranchQuery, pickMergeRequest } from "./mergeRequests";
import { draftTitle } from "./mrActions";
import { mapNotes, toPullRequestDetail, unifiedDiff } from "./mrDetail";
import { toMrSnapshot } from "./mrWatch";

const HOST = "gitlab.com";

function mr(overrides: Partial<BranchMrNode>): BranchMrNode {
  return {
    iid: "4",
    webUrl: "https://gitlab.com/g/p/-/merge_requests/4",
    state: "opened",
    draft: false,
    createdAt: "2026-01-01T00:00:00Z",
    sourceBranch: "feat",
    sourceProject: { fullPath: "g/p" },
    ...overrides,
  };
}

describe("pickMergeRequest", () => {
  it("maps states and picks the newest from the project's own repos", () => {
    expect(pickMergeRequest([mr({ draft: true })], "feat", ["g/p"])).toEqual({
      number: 4,
      state: "draft",
      url: "https://gitlab.com/g/p/-/merge_requests/4",
    });
    const picked = pickMergeRequest(
      [
        mr({ iid: "1", state: "merged" }),
        mr({
          iid: "9",
          createdAt: "2026-03-01T00:00:00Z",
          sourceProject: { fullPath: "stranger/p" },
        }),
        mr({ iid: "2", createdAt: "2026-02-01T00:00:00Z", state: "closed" }),
      ],
      "feat",
      ["G/P"],
    );
    expect(picked).toMatchObject({ number: 2, state: "closed" });
  });

  it("quotes branch names in the query", () => {
    expect(buildBranchQuery([{ path: "g/p", branches: ['a"b'] }])).toContain(
      'sourceBranches: ["a\\"b"]',
    );
  });
});

describe("jobs", () => {
  it("treats allowed failures and manual jobs as non-blocking", () => {
    expect(jobCheck(HOST, { name: "lint", status: "FAILED" })).toMatchObject({
      status: "completed",
      conclusion: "failure",
    });
    expect(
      jobCheck(HOST, { name: "x", status: "FAILED", allowFailure: true })
        .conclusion,
    ).toBe("neutral");
    expect(
      jobCheck(HOST, {
        name: "deploy",
        status: "MANUAL",
        webPath: "/g/p/-/jobs/3",
      }),
    ).toMatchObject({
      conclusion: "neutral",
      detailsUrl: "https://gitlab.com/g/p/-/jobs/3",
    });
    expect(jobCheck(HOST, { status: "RUNNING" }).status).toBe("in_progress");
    expect(jobsClean(HOST, [{ status: "SUCCESS" }, { status: "MANUAL" }])).toBe(
      true,
    );
    expect(jobsClean(HOST, [{ status: "PENDING" }])).toBe(false);
    expect(jobsClean(HOST, [])).toBeNull();
    expect(
      watchedJob(HOST, { status: "FAILED", allowFailure: true }),
    ).toMatchObject({ bucket: "skip", required: false });
  });

  it("strips colours and section markers from a trace", () => {
    const esc = String.fromCharCode(27);
    const raw = `section_start:1700000000:step_script\r${esc}[0K${esc}[32;1mRunning${esc}[0;m\nprogress 10%\rprogress 100%\n${esc}[31mFAIL a.test.ts${esc}[0m\nsection_end:1700000001:step_script\r${esc}[0K\n`;
    expect(trimJobTrace(raw)).toBe("Running\nprogress 100%\nFAIL a.test.ts");
  });
});

describe("mrDetail", () => {
  it("maps a merge request onto the pull request detail", () => {
    const node: MrDetailNode = {
      iid: "4",
      title: "Add thing",
      webUrl: "https://gitlab.com/g/p/-/merge_requests/4",
      state: "opened",
      draft: false,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      sourceBranch: "feat",
      targetBranch: "main",
      conflicts: false,
      detailedMergeStatus: "MERGEABLE",
      author: { username: "ana", avatarUrl: "/uploads/a.png" },
      diffStatsSummary: { additions: 3, deletions: 1, fileCount: 1 },
      diffStats: [{ path: "a.ts", additions: 3, deletions: 1 }],
      commitCount: 1,
      commits: {
        nodes: [{ sha: "abc123", shortId: "abc1", message: "feat: thing" }],
      },
      headPipeline: {
        status: "FAILED",
        jobs: { nodes: [{ name: "test", status: "FAILED" }] },
      },
      notes: { nodes: [] },
    };
    const detail = toPullRequestDetail(
      HOST,
      { fullPath: "g/p", webUrl: "https://gitlab.com/g/p" },
      node,
    );
    expect(detail).toMatchObject({
      number: 4,
      state: "OPEN",
      merged: false,
      mergeable: "MERGEABLE",
      repoNameWithOwner: "g/p",
      authorAvatarUrl: "https://gitlab.com/uploads/a.png",
      changedFiles: 1,
      checks: [{ name: "test", conclusion: "failure" }],
    });
    expect(detail.commitList[0]?.statusRollup).toBe("failed");
  });

  it("drops system notes and nests diff notes as reviews", () => {
    const comments = mapNotes(HOST, [
      { id: "1", body: "merged", system: true, createdAt: "1" },
      { id: "2", body: "looks good", system: false, createdAt: "2", url: "u2" },
      {
        id: "3",
        body: "rename this",
        system: false,
        createdAt: "3",
        url: "u3",
        position: { filePath: "a.ts", newLine: 4 },
      },
    ]);
    expect(comments.map((c) => c.kind)).toEqual(["issue", "review"]);
    expect(comments[1]?.inlineComments?.[0]?.body).toBe(
      "a.ts:4\n\nrename this",
    );
  });

  it("rebuilds a git diff from GitLab's per-file hunks", () => {
    expect(
      unifiedDiff([
        {
          old_path: "a.ts",
          new_path: "a.ts",
          new_file: false,
          deleted_file: false,
          diff: "@@ -1 +1 @@\n-a\n+b\n",
        },
        {
          old_path: "b.ts",
          new_path: "b.ts",
          new_file: true,
          deleted_file: false,
          diff: "@@ -0,0 +1 @@\n+c",
        },
      ]),
    ).toBe(
      "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n" +
        "diff --git a/b.ts b/b.ts\nnew file mode 100644\n--- /dev/null\n+++ b/b.ts\n@@ -0,0 +1 @@\n+c\n",
    );
  });

  it("marks drafts by title once", () => {
    expect(draftTitle("Add thing", true)).toBe("Draft: Add thing");
    expect(draftTitle("Draft: Add thing", true)).toBe("Draft: Add thing");
    expect(draftTitle("Add thing", false)).toBe("Add thing");
  });
});

describe("toMrSnapshot", () => {
  it("wakes on a failed required job and a reviewer's diff note", () => {
    const snap = toMrSnapshot(
      HOST,
      {
        iid: "4",
        webUrl: "https://gitlab.com/g/p/-/merge_requests/4",
        state: "opened",
        conflicts: false,
        diffHeadSha: "abc",
        headPipeline: {
          jobs: {
            nodes: [
              { name: "test", status: "FAILED", webPath: "/g/p/-/jobs/9" },
              { name: "flaky", status: "FAILED", allowFailure: true },
            ],
          },
        },
        notes: { nodes: [] },
      },
      "me",
    );
    expect(snap.state).toBe("OPEN");
    expect(checksGreen(snap.checks)).toBe(false);
    const memory = emptyMemory();
    const events = diffSnapshot(memory, snap);
    expect(
      events
        .filter((e) => e.kind === "check_failed")
        .map((e) => (e.kind === "check_failed" ? e.check.name : "")),
    ).toEqual(["test"]);

    const later = toMrSnapshot(
      HOST,
      {
        iid: "4",
        webUrl: snap.url,
        state: "opened",
        conflicts: true,
        diffHeadSha: "abc",
        notes: {
          nodes: [
            {
              id: "n1",
              body: "rename",
              system: false,
              url: "u",
              author: { username: "ana" },
              position: { filePath: "a.ts", newLine: 2 },
            },
          ],
        },
      },
      "me",
    );
    expect(later.mergeable).toBe("CONFLICTING");
    expect(later.comments[0]).toMatchObject({
      kind: "inline",
      location: "a.ts:2",
    });
  });
});
