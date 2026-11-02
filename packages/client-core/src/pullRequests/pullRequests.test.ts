import type { RemotePullRequest } from "@argus/remote-protocol";
import { describe, expect, it } from "vitest";
import {
  countAwaitingMyReview,
  groupByBucket,
  prBucket,
  remotePullRequestSignals,
} from "./bucket";
import {
  checksSummary,
  checkTone,
  explainPullRequestError,
  parsePrMergeStrategy,
  parsePullRequestUrl,
  prStateLabel,
  relativeTimeMs,
} from "./labels";

// Vectors shared with ArgusCore's `PullRequestBucketTests`.
function pr(
  number: number,
  reasons: string[],
  {
    review = null,
    draft = false,
    updated = "2026-01-01T00:00:00Z",
  }: { draft?: boolean; review?: string | null; updated?: string } = {},
): RemotePullRequest {
  return {
    number,
    title: `PR ${number}`,
    repo: "o/r",
    repo_root: "/r",
    author: null,
    is_draft: draft,
    review_decision: review,
    head_ref: "h",
    base_ref: "main",
    url: "https://x",
    updated_at: updated,
    reasons,
  };
}

const bucket = (p: RemotePullRequest) => prBucket(remotePullRequestSignals(p));

describe("pull request buckets", () => {
  it("a review request waits on me until approved; drafts beat review states", () => {
    expect(bucket(pr(1, ["reviewer"]))).toBe("awaiting-me");
    expect(bucket(pr(1, ["team"], { draft: true }))).toBe("awaiting-me");
    expect(bucket(pr(1, ["reviewer"], { review: "APPROVED" }))).toBe(
      "approved",
    );
    expect(
      bucket(pr(1, ["author"], { review: "CHANGES_REQUESTED", draft: true })),
    ).toBe("draft");
    expect(bucket(pr(1, ["author"], { review: "CHANGES_REQUESTED" }))).toBe(
      "changes-requested",
    );
    expect(bucket(pr(1, ["author"]))).toBe("awaiting-others");
    expect(bucket(pr(1, ["mentioned"]))).toBe("other");
  });

  it("buckets in display order, direct requests before team ones, then newest first", () => {
    const groups = groupByBucket(
      [
        pr(1, ["author"]),
        pr(2, ["team"], { updated: "2026-03-01T00:00:00Z" }),
        pr(3, ["reviewer"], { updated: "2026-01-01T00:00:00Z" }),
        pr(4, ["reviewer"], { updated: "2026-02-01T00:00:00Z" }),
      ],
      remotePullRequestSignals,
    );
    expect(groups.map((g) => g.bucket)).toEqual([
      "awaiting-me",
      "awaiting-others",
    ]);
    expect(groups[0].prs.map((p) => p.number)).toEqual([4, 3, 2]);
  });

  it("counts what awaits my review", () => {
    expect(
      countAwaitingMyReview(
        [pr(1, ["reviewer"]), pr(2, ["author"]), pr(3, ["team"])],
        remotePullRequestSignals,
      ),
    ).toBe(2);
    expect(countAwaitingMyReview(null, remotePullRequestSignals)).toBe(0);
  });
});

describe("pull request labels", () => {
  it("reads check tones the way ArgusKit does", () => {
    expect(checkTone("SUCCESS", null)).toBe("success");
    expect(checkTone("skipped", "completed")).toBe("success");
    expect(checkTone("failure", "completed")).toBe("error");
    expect(checkTone("cancelled", "completed")).toBe("muted");
    expect(checkTone(null, "in_progress")).toBe("warning");
    expect(checkTone(null, "COMPLETED")).toBe("muted");
  });

  it("summarises checks, failures first", () => {
    expect(checksSummary([])).toBeNull();
    expect(
      checksSummary([
        { conclusion: "success", status: "completed" },
        { conclusion: null, status: "queued" },
      ])?.title,
    ).toBe("1 check in progress");
    expect(
      checksSummary([
        { conclusion: "failure", status: "completed" },
        { conclusion: "failure", status: "completed" },
        { conclusion: null, status: "queued" },
      ]),
    ).toMatchObject({ title: "2 checks failing", tone: "error", pending: 1 });
    expect(
      checksSummary([{ conclusion: "success", status: "completed" }])?.tone,
    ).toBe("success");
  });

  it("says what state a PR is in", () => {
    expect(
      prStateLabel({ merged: true, state: "MERGED", isDraft: false }),
    ).toEqual({
      label: "Merged",
      tone: "accent",
    });
    expect(
      prStateLabel({ merged: false, state: "CLOSED", isDraft: true }).label,
    ).toBe("Closed");
    expect(
      prStateLabel({ merged: false, state: "OPEN", isDraft: true }).label,
    ).toBe("Draft");
  });

  it("explains gh being missing or signed out", () => {
    expect(explainPullRequestError("spawn gh ENOENT")).toMatch(/is required/);
    expect(
      explainPullRequestError("To get started, run gh auth login"),
    ).toMatch(/isn't signed in/);
    expect(explainPullRequestError("rate limited")).toBe("rate limited");
  });

  it("parses a PR url and a remembered strategy", () => {
    expect(parsePullRequestUrl("https://github.com/o/r/pull/12")).toEqual({
      owner: "o",
      repo: "r",
      number: 12,
    });
    expect(parsePullRequestUrl("https://example.com")).toBeNull();
    expect(parsePrMergeStrategy("rebase")).toBe("rebase");
    expect(parsePrMergeStrategy("nonsense")).toBe("squash");
    expect(parsePrMergeStrategy(null)).toBe("squash");
  });

  it("buckets ages", () => {
    const now = 1_000_000_000_000;
    expect(relativeTimeMs(now - 5_000, now)).toBe("just now");
    expect(relativeTimeMs(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(relativeTimeMs(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(relativeTimeMs(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});
