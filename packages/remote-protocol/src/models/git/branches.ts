import { z } from "zod";

export const BranchList = z.object({
  local: z.array(z.string()),
  remote: z.array(z.string()),
  /**
   * All origin-tracking refs as `origin/<name>`, including those whose name
   * also exists locally.
   */
  originRefs: z.array(z.string()),
});
export type BranchList = z.infer<typeof BranchList>;

export const BranchCommitSummary = z.object({
  hash: z.string(),
  subject: z.string(),
  author: z.string(),
  timestamp: z.number(),
});
export type BranchCommitSummary = z.infer<typeof BranchCommitSummary>;

export const EnrichedBranch = z.object({
  name: z.string(),
  fullName: z.string(),
  upstream: z.string().nullable(),
  ahead: z.number(),
  behind: z.number(),
  isCurrent: z.boolean(),
  lastCommit: BranchCommitSummary.nullable(),
});
export type EnrichedBranch = z.infer<typeof EnrichedBranch>;

export const GitRemoteBranch = z.object({
  name: z.string(),
  remote: z.string(),
  branchName: z.string(),
  lastCommit: BranchCommitSummary.nullable(),
});
export type GitRemoteBranch = z.infer<typeof GitRemoteBranch>;

export const GitCompareResult = z.object({
  /** Commits on `left` not reachable from `right`, newest first. */
  leftOnly: z.array(BranchCommitSummary),
  /** Commits on `right` not reachable from `left`, newest first. */
  rightOnly: z.array(BranchCommitSummary),
  /** SHA of the merge-base, or null when the refs share no history. */
  mergeBase: z.string().nullable(),
  /** Best-effort: true if `git merge-tree` reports conflict markers. */
  wouldConflict: z.boolean(),
});
export type GitCompareResult = z.infer<typeof GitCompareResult>;

export const PushSessionBranchResult = z.object({
  branch: z.string(),
  prUrl: z.string().nullable(),
  remoteName: z.string(),
});
export type PushSessionBranchResult = z.infer<typeof PushSessionBranchResult>;
