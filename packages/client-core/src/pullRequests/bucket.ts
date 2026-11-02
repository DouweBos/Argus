/**
 * Where a PR sits in the list: what needs you first, the quiet ones after.
 * Shared by the desktop's Pull requests screen (and its sidebar badge), the
 * web client and, as `PullRequestBucket.swift`, the Mac and the phone — the
 * tests share their vectors.
 */

import type { RemotePullRequest } from "@argus/remote-protocol";

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

/** From "most actionable for me" to least. */
export const BUCKET_ORDER: PrBucket[] = [
  "awaiting-me",
  "changes-requested",
  "awaiting-others",
  "approved",
  "draft",
  "other",
];

/** Buckets that need the viewer now; the rest sit behind a divider. */
export const ATTENTION_BUCKETS: ReadonlySet<PrBucket> = new Set<PrBucket>([
  "awaiting-me",
  "changes-requested",
  "approved",
]);

/** What bucketing reads off a PR, whichever shape the client holds it in. */
export interface PrBucketSignals {
  isDraft: boolean;
  reasons: readonly string[];
  reviewDecision: string | null;
  updatedAt: string;
}

/** The gateway's snake_case PR, read as bucketing signals. */
export function remotePullRequestSignals(
  pr: RemotePullRequest,
): PrBucketSignals {
  return {
    isDraft: pr.is_draft,
    reasons: pr.reasons,
    reviewDecision: pr.review_decision,
    updatedAt: pr.updated_at,
  };
}

export function prBucket(pr: PrBucketSignals): PrBucket {
  const awaitingMe =
    pr.reasons.includes("reviewer") || pr.reasons.includes("team");
  // A draft that asks for review still waits on me: that's where the action is.
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

export interface PrBucketGroup<T> {
  bucket: PrBucket;
  prs: T[];
}

/**
 * Buckets in display order, each newest first; inside "Awaiting my review"
 * direct reviewer requests go ahead of team ones.
 */
export function groupByBucket<T>(
  prs: readonly T[],
  signalsOf: (pr: T) => PrBucketSignals,
): PrBucketGroup<T>[] {
  const grouped = new Map<PrBucket, T[]>();
  for (const pr of prs) {
    const bucket = prBucket(signalsOf(pr));
    grouped.set(bucket, [...(grouped.get(bucket) ?? []), pr]);
  }

  return BUCKET_ORDER.flatMap((bucket) => {
    const list = grouped.get(bucket);
    if (!list) {
      return [];
    }
    const sorted = [...list].sort((a, b) => {
      const sa = signalsOf(a);
      const sb = signalsOf(b);
      if (bucket === "awaiting-me") {
        const da = sa.reasons.includes("reviewer");
        const db = sb.reasons.includes("reviewer");
        if (da !== db) {
          return da ? -1 : 1;
        }
      }
      if (sa.updatedAt === sb.updatedAt) {
        return 0;
      }

      return sa.updatedAt < sb.updatedAt ? 1 : -1;
    });

    return [{ bucket, prs: sorted }];
  });
}

export function countAwaitingMyReview<T>(
  prs: readonly T[] | null | undefined,
  signalsOf: (pr: T) => PrBucketSignals,
): number {
  return (prs ?? []).filter((pr) => prBucket(signalsOf(pr)) === "awaiting-me")
    .length;
}
