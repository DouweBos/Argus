import { z } from "zod";

export const PullRequestReason = z.enum([
  "author",
  "commenter",
  "mentioned",
  "reviewer",
  "team",
]);
export type PullRequestReason = z.infer<typeof PullRequestReason>;

export const InterestingPullRequest = z.object({
  author: z.string().nullable(),
  authorAvatarUrl: z.string().nullable(),
  baseRefName: z.string(),
  createdAt: z.string(),
  headRefName: z.string(),
  isDraft: z.boolean(),
  number: z.number(),
  reasons: z.array(PullRequestReason),
  repoNameWithOwner: z.string(),
  /** Absolute path of the Argus-open project this PR's repo maps to. */
  repoRoot: z.string(),
  repoUrl: z.string(),
  /** `APPROVED` | `CHANGES_REQUESTED` | `REVIEW_REQUIRED` | null. */
  reviewDecision: z.string().nullable(),
  title: z.string(),
  updatedAt: z.string(),
  url: z.string(),
});
export type InterestingPullRequest = z.infer<typeof InterestingPullRequest>;

export const CheckConclusion = z.enum([
  "action_required",
  "cancelled",
  "failure",
  "neutral",
  "skipped",
  "stale",
  "startup_failure",
  "success",
  "timed_out",
]);
export type CheckConclusion = z.infer<typeof CheckConclusion>;

export const CheckStatus = z.enum([
  "completed",
  "in_progress",
  "pending",
  "queued",
  "requested",
  "waiting",
]);
export type CheckStatus = z.infer<typeof CheckStatus>;

export const PullRequestFile = z.object({
  additions: z.number(),
  changeType: z.string(),
  deletions: z.number(),
  path: z.string(),
});
export type PullRequestFile = z.infer<typeof PullRequestFile>;

export const PullRequestCommit = z.object({
  abbreviatedOid: z.string(),
  author: z.string().nullable(),
  authorAvatarUrl: z.string().nullable(),
  committedDate: z.string(),
  message: z.string(),
  oid: z.string(),
  statusRollup: z.string().nullable(),
  url: z.string(),
});
export type PullRequestCommit = z.infer<typeof PullRequestCommit>;

export const PullRequestCheck = z.object({
  conclusion: CheckConclusion.nullable(),
  detailsUrl: z.string().nullable(),
  name: z.string(),
  status: CheckStatus.nullable(),
  /** Plain status-context description (populated for legacy statuses only). */
  description: z.string().nullable(),
});
export type PullRequestCheck = z.infer<typeof PullRequestCheck>;

export const InlineReviewComment = z.object({
  body: z.string(),
  /** GitHub's pre-rendered HTML — includes autolinks, emoji, task lists. */
  bodyHtml: z.string(),
  createdAt: z.string(),
  id: z.string(),
  url: z.string(),
});
export type InlineReviewComment = z.infer<typeof InlineReviewComment>;

export const PullRequestComment = z.object({
  author: z.string().nullable(),
  authorAvatarUrl: z.string().nullable(),
  body: z.string(),
  /** GitHub's pre-rendered HTML — includes autolinks, emoji, task lists. */
  bodyHtml: z.string(),
  createdAt: z.string(),
  id: z.string(),
  /** Inline review comments attached to a `kind === "review"` entry. */
  inlineComments: z.array(InlineReviewComment).optional(),
  kind: z.enum(["issue", "review"]),
  /** Review verdict for `kind === "review"` entries. */
  reviewState: z.string().optional(),
  url: z.string(),
});
export type PullRequestComment = z.infer<typeof PullRequestComment>;

export const PullRequestDetail = z.object({
  additions: z.number(),
  author: z.string().nullable(),
  authorAvatarUrl: z.string().nullable(),
  baseRefName: z.string(),
  body: z.string(),
  /** GitHub's pre-rendered HTML — includes autolinks, emoji, task lists. */
  bodyHtml: z.string(),
  changedFiles: z.number(),
  checks: z.array(PullRequestCheck),
  comments: z.array(PullRequestComment),
  commitList: z.array(PullRequestCommit),
  commits: z.number(),
  createdAt: z.string(),
  deletions: z.number(),
  files: z.array(PullRequestFile),
  headRefName: z.string(),
  isDraft: z.boolean(),
  labels: z.array(z.string()),
  merged: z.boolean(),
  mergeable: z.string(),
  number: z.number(),
  repoNameWithOwner: z.string(),
  repoUrl: z.string(),
  state: z.string(),
  title: z.string(),
  updatedAt: z.string(),
  url: z.string(),
});
export type PullRequestDetail = z.infer<typeof PullRequestDetail>;

export const PullRequestMergeStrategy = z.enum(["merge", "rebase", "squash"]);
export type PullRequestMergeStrategy = z.infer<typeof PullRequestMergeStrategy>;

export const CreatedPullRequest = z.object({
  number: z.number(),
  url: z.string(),
});
export type CreatedPullRequest = z.infer<typeof CreatedPullRequest>;

export const GhIssue = z.object({ number: z.number(), title: z.string() });
export type GhIssue = z.infer<typeof GhIssue>;
