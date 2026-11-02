/**
 * The desktop's PR shape over `@argus/client-core`'s bucketing, so the
 * sidebar badge, the Pull requests screen, the web client and the Swift apps
 * agree on "is this PR awaiting my review?".
 */

import type { InterestingPullRequest } from "./types";
import {
  type PrBucket,
  type PrBucketSignals,
  countAwaitingMyReview as countAwaiting,
  groupByBucket as group,
  prBucket as bucketOf,
} from "@argus/client-core";

export {
  ATTENTION_BUCKETS,
  BUCKET_LABEL,
  BUCKET_ORDER,
  type PrBucket,
} from "@argus/client-core";

const signals = (pr: InterestingPullRequest): PrBucketSignals => pr;

export function prBucket(pr: InterestingPullRequest): PrBucket {
  return bucketOf(pr);
}

/** Direct reviewer requests ahead of team ones, newest first within each. */
export function sortAwaitingMe(
  prs: InterestingPullRequest[],
): InterestingPullRequest[] {
  // Read every PR as awaiting me, so only the within-bucket order applies.
  return (
    group(prs, (pr) => ({
      ...signals(pr),
      isDraft: false,
      reasons: [...pr.reasons, "team"],
      reviewDecision: null,
    }))[0]?.prs ?? []
  );
}

export function groupByBucket(
  prs: InterestingPullRequest[],
): Map<PrBucket, InterestingPullRequest[]> {
  return new Map(group(prs, signals).map((g) => [g.bucket, g.prs]));
}

export function countAwaitingMyReview(
  prs: InterestingPullRequest[] | null | undefined,
): number {
  return countAwaiting(prs, signals);
}
