import { z } from "zod";

export const GitCommit = z.object({
  hash: z.string(),
  abbreviatedHash: z.string(),
  author: z.string(),
  authorEmail: z.string(),
  date: z.string(),
  committer: z.string(),
  committerEmail: z.string(),
  committerDate: z.string(),
  parentHash: z.string(),
  treeHash: z.string(),
  subject: z.string(),
  refs: z.string(),
  body: z.string(),
});
export type GitCommit = z.infer<typeof GitCommit>;

export const GitStashEntry = z.object({
  index: z.number(),
  hash: z.string(),
  author: z.string(),
  authorEmail: z.string(),
  date: z.string(),
  parentHash: z.string(),
  message: z.string(),
});
export type GitStashEntry = z.infer<typeof GitStashEntry>;

export const LogSearchCursor = z.object({
  lastCommitHash: z.string(),
  lastCommitTimestamp: z.string(),
});
export type LogSearchCursor = z.infer<typeof LogSearchCursor>;

export const LogSearchResult = z.object({
  commits: z.array(GitCommit),
  nextCursor: LogSearchCursor.nullable(),
});
export type LogSearchResult = z.infer<typeof LogSearchResult>;

export const GitDiffRangeFile = z.object({
  newPath: z.string(),
  oldPath: z.string(),
  patch: z.string(),
  status: z.string(),
});
export type GitDiffRangeFile = z.infer<typeof GitDiffRangeFile>;

export const GitDiffRangeResult = z.object({
  files: z.array(GitDiffRangeFile),
});
export type GitDiffRangeResult = z.infer<typeof GitDiffRangeResult>;

export const BlameChunk = z.object({
  author: z.string(),
  authorEmail: z.string(),
  authorTime: z.number(),
  commitHash: z.string(),
  /** Optional file content for this chunk (one entry per line). */
  content: z.array(z.string()).optional(),
  lineCount: z.number(),
  lineStart: z.number(),
  summary: z.string(),
});
export type BlameChunk = z.infer<typeof BlameChunk>;

export const ReflogEntry = z.object({
  action: z.string(),
  hash: z.string(),
  refName: z.string(),
  subject: z.string(),
  timestamp: z.string(),
});
export type ReflogEntry = z.infer<typeof ReflogEntry>;

export const RebaseAction = z.enum([
  "drop",
  "edit",
  "fixup",
  "pick",
  "reword",
  "squash",
]);
export type RebaseAction = z.infer<typeof RebaseAction>;

export const RebasePlanCommit = z.object({
  author: z.string(),
  hash: z.string(),
  subject: z.string(),
});
export type RebasePlanCommit = z.infer<typeof RebasePlanCommit>;

export const RebasePlanEntry = z.object({
  action: RebaseAction,
  hash: z.string(),
  newSubject: z.string().optional(),
});
export type RebasePlanEntry = z.infer<typeof RebasePlanEntry>;

export const BisectStep = z.object({
  currentRef: z.string().nullable(),
  currentSubject: z.string().nullable(),
  finished: z.boolean(),
  firstBadCommit: z
    .object({ hash: z.string(), subject: z.string() })
    .optional(),
  remaining: z.number().nullable(),
});
export type BisectStep = z.infer<typeof BisectStep>;

export const BisectStatus = BisectStep.extend({ active: z.boolean() });
export type BisectStatus = z.infer<typeof BisectStatus>;

export const GitStashSaveOptions = z.object({
  includeUntracked: z.boolean().optional(),
  keepIndex: z.boolean().optional(),
  message: z.string().optional(),
  /** Restrict the stash to these pathspecs (relative to repo root). */
  paths: z.array(z.string()).optional(),
});
export type GitStashSaveOptions = z.infer<typeof GitStashSaveOptions>;

export const LogSearchFilters = z.object({
  author: z.string().optional(),
  branch: z.string().optional(),
  cursor: LogSearchCursor.nullish(),
  limit: z.number().optional(),
  paths: z.array(z.string()).optional(),
  query: z.string().optional(),
  refType: z.enum(["all", "locals", "remotes", "tags"]).optional(),
  regex: z.boolean().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
});
export type LogSearchFilters = z.infer<typeof LogSearchFilters>;

export const ReflogOptions = z.object({
  limit: z.number().optional(),
  ref: z.string().optional(),
});
export type ReflogOptions = z.infer<typeof ReflogOptions>;
