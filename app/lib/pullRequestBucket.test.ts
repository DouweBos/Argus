import type { InterestingPullRequest, PullRequestReason } from "./types";
import { describe, expect, it } from "vitest";
import {
  countAwaitingMyReview,
  groupByBucket,
  prBucket,
  sortAwaitingMe,
} from "./pullRequestBucket";

function pr(
  overrides: Partial<InterestingPullRequest> = {},
): InterestingPullRequest {
  return {
    author: "alice",
    authorAvatarUrl: null,
    baseRefName: "main",
    createdAt: "2025-01-01T00:00:00Z",
    headRefName: "feature",
    isDraft: false,
    number: 1,
    reasons: ["author"] as PullRequestReason[],
    repoNameWithOwner: "acme/app",
    repoRoot: "/acme/app",
    repoUrl: "https://example.test/acme/app",
    reviewDecision: null,
    title: "PR title",
    updatedAt: "2025-01-01T00:00:00Z",
    url: "https://example.test/pr/1",
    ...overrides,
  };
}

describe("prBucket", () => {
  it("routes direct reviewer requests to awaiting-me", () => {
    expect(prBucket(pr({ reasons: ["reviewer"] }))).toBe("awaiting-me");
  });

  it("routes team reviewer requests to awaiting-me", () => {
    expect(prBucket(pr({ reasons: ["team"] }))).toBe("awaiting-me");
  });

  it("drops a PR out of awaiting-me once it's approved", () => {
    expect(
      prBucket(pr({ reasons: ["reviewer"], reviewDecision: "APPROVED" })),
    ).toBe("approved");
  });

  it("routes drafts to draft when no review is pending", () => {
    expect(prBucket(pr({ reasons: ["author"], isDraft: true }))).toBe("draft");
  });

  it("keeps a draft in awaiting-me if a review is still requested", () => {
    expect(prBucket(pr({ reasons: ["reviewer"], isDraft: true }))).toBe(
      "awaiting-me",
    );
  });

  it("routes CHANGES_REQUESTED to changes-requested", () => {
    expect(
      prBucket(
        pr({ reasons: ["author"], reviewDecision: "CHANGES_REQUESTED" }),
      ),
    ).toBe("changes-requested");
  });

  it("routes authored PRs awaiting review to awaiting-others", () => {
    expect(prBucket(pr({ reasons: ["author"] }))).toBe("awaiting-others");
  });

  it("falls back to other for incidental involvement", () => {
    expect(prBucket(pr({ reasons: ["commenter"] }))).toBe("other");
    expect(prBucket(pr({ reasons: ["mentioned"] }))).toBe("other");
  });
});

describe("sortAwaitingMe", () => {
  it("puts explicit reviewer requests ahead of team requests, newest-first within each", () => {
    const prs = [
      pr({
        number: 1,
        reasons: ["team"],
        updatedAt: "2025-01-05T00:00:00Z",
      }),
      pr({
        number: 2,
        reasons: ["reviewer"],
        updatedAt: "2025-01-01T00:00:00Z",
      }),
      pr({
        number: 3,
        reasons: ["reviewer"],
        updatedAt: "2025-01-03T00:00:00Z",
      }),
      pr({
        number: 4,
        reasons: ["team"],
        updatedAt: "2025-01-02T00:00:00Z",
      }),
    ];
    const sorted = sortAwaitingMe(prs);
    expect(sorted.map((p) => p.number)).toEqual([3, 2, 1, 4]);
  });
});

describe("groupByBucket", () => {
  it("groups each PR under its bucket and sub-sorts awaiting-me", () => {
    const prs = [
      pr({
        number: 1,
        reasons: ["team"],
        updatedAt: "2025-01-05T00:00:00Z",
      }),
      pr({
        number: 2,
        reasons: ["reviewer"],
        updatedAt: "2025-01-01T00:00:00Z",
      }),
      pr({
        number: 3,
        reasons: ["author"],
        reviewDecision: "APPROVED",
      }),
      pr({ number: 4, reasons: ["author"], isDraft: true }),
    ];
    const out = groupByBucket(prs);
    expect(out.get("awaiting-me")?.map((p) => p.number)).toEqual([2, 1]);
    expect(out.get("approved")?.map((p) => p.number)).toEqual([3]);
    expect(out.get("draft")?.map((p) => p.number)).toEqual([4]);
  });
});

describe("countAwaitingMyReview", () => {
  it("returns 0 for null / empty input", () => {
    expect(countAwaitingMyReview(null)).toBe(0);
    expect(countAwaitingMyReview(undefined)).toBe(0);
    expect(countAwaitingMyReview([])).toBe(0);
  });

  it("counts only awaiting-me PRs — not approved, draft, or author-only", () => {
    const prs = [
      pr({ reasons: ["reviewer"] }),
      pr({ reasons: ["team"] }),
      pr({ reasons: ["reviewer"], reviewDecision: "APPROVED" }),
      pr({ reasons: ["author"] }),
      pr({ reasons: ["author"], isDraft: true }),
    ];
    expect(countAwaitingMyReview(prs)).toBe(2);
  });
});
