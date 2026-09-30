import { z } from "zod";

export const GitInProgress = z.object({
  kind: z.enum(["bisect", "cherry-pick", "merge", "rebase"]),
  head: z.string(),
  onto: z.string().optional(),
});
export type GitInProgress = z.infer<typeof GitInProgress>;

export const GitStatus = z.object({
  branch: z.string(),
  upstream: z.string().nullable(),
  ahead: z.number(),
  behind: z.number(),
  dirtyCount: z.number(),
  stashCount: z.number(),
  conflictCount: z.number(),
  inProgress: GitInProgress.nullable(),
  detached: z.boolean(),
  /** Unix ms timestamp of `.git/FETCH_HEAD` mtime, or null if never fetched. */
  lastFetchAt: z.number().nullable(),
});
export type GitStatus = z.infer<typeof GitStatus>;

export const ConflictBlobs = z.object({
  ours: z.string(),
  base: z.string(),
  theirs: z.string(),
  merged: z.string(),
});
export type ConflictBlobs = z.infer<typeof ConflictBlobs>;
