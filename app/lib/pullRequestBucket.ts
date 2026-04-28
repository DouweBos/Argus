/**
 * Classification + sorting helpers for PRs on the Pull requests screen.
 *
 * Lives in `app/lib` so the sidebar count badge can reuse the exact same
 * bucket logic the screen itself uses — one source of truth for "is this
 * PR awaiting my review?".
 */

import type { InterestingPullRequest } from "./types";

export type PrBucket =
  | "approved"
  | "awaiting-me"
  | "awaiting-others"
  | "changes-requested"
  | "draft"
  | "other";

export const BUCKET_LABEL: Record<PrBucket, string> = {
  "awaiting-me": "Awaiting my review",
  "changes-requested": "Changes requested",
  "awaiting-others": "Awaiting another review",
  approved: "Approved",
  draft: "Draft",
  other: "Other",
};

/** Order sections from "most actionable for me" to least. */
export const BUCKET_ORDER: PrBucket[] = [
  "awaiting-me",
  "changes-requested",
  "awaiting-others",
  "approved",
  "draft",
  "other",
];

/**
 * Buckets that require the viewer to *do* something now. Everything else —
 * PRs on others' plates, approved, drafts, incidental mentions — is rendered
 * behind a divider in a muted treatment so the top of the page stays focused
 * on work that's blocked on the current user.
 */
export const ATTENTION_BUCKETS = new Set<PrBucket>([
  "awaiting-me",
  "changes-requested",
  "approved",
]);

export function prBucket(pr: InterestingPullRequest): PrBucket {
  const awaitingMe =
    pr.reasons.includes("reviewer") || pr.reasons.includes("team");
  // Drafts rarely request reviews, but if one does the review request still
  // wins — that's where the action is.
  if (awaitingMe && pr.reviewDecision !== "APPROVED") {
    return "awaiting-me";
  }
  if (pr.isDraft) {
    return "draft";
  }
  if (pr.reviewDecision === "CHANGES_REQUESTED") {
    return "changes-requested";
  }
  if (pr.reviewDecision === "APPROVED") {
    return "approved";
  }
  if (pr.reasons.includes("author")) {
    return "awaiting-others";
  }

  return "other";
}

function byUpdatedAtDesc(
  a: InterestingPullRequest,
  b: InterestingPullRequest,
): number {
  return a.updatedAt < b.updatedAt ? 1 : -1;
}

/**
 * Within "Awaiting my review", put explicit reviewer requests ahead of team
 * requests — when I'm personally on the hook I want that in front, even if a
 * team request is slightly newer. Within each sub-group, newest first.
 */
export function sortAwaitingMe(
  prs: InterestingPullRequest[],
): InterestingPullRequest[] {
  const directReviewer: InterestingPullRequest[] = [];
  const teamReviewer: InterestingPullRequest[] = [];
  for (const pr of prs) {
    if (pr.reasons.includes("reviewer")) {
      directReviewer.push(pr);
    } else {
      teamReviewer.push(pr);
    }
  }
  directReviewer.sort(byUpdatedAtDesc);
  teamReviewer.sort(byUpdatedAtDesc);

  return [...directReviewer, ...teamReviewer];
}

export function groupByBucket(
  prs: InterestingPullRequest[],
): Map<PrBucket, InterestingPullRequest[]> {
  const map = new Map<PrBucket, InterestingPullRequest[]>();
  for (const pr of prs) {
    const bucket = prBucket(pr);
    const existing = map.get(bucket) ?? [];
    existing.push(pr);
    map.set(bucket, existing);
  }
  const awaitingMe = map.get("awaiting-me");
  if (awaitingMe) {
    map.set("awaiting-me", sortAwaitingMe(awaitingMe));
  }

  return map;
}

export function countAwaitingMyReview(
  prs: InterestingPullRequest[] | null | undefined,
): number {
  if (!prs) {
    return 0;
  }
  let n = 0;
  for (const pr of prs) {
    if (prBucket(pr) === "awaiting-me") {
      n++;
    }
  }

  return n;
}
