import { z } from "zod";

export const DirEntry = z.object({
  is_dir: z.boolean(),
  name: z.string(),
  size: z.number(),
});
export type DirEntry = z.infer<typeof DirEntry>;

export const MentionDirEntry = z.object({
  is_dir: z.boolean(),
  name: z.string(),
});
export type MentionDirEntry = z.infer<typeof MentionDirEntry>;

export const MentionPathResult = z.object({
  entries: z.array(MentionDirEntry),
  resolvedPath: z.string(),
});
export type MentionPathResult = z.infer<typeof MentionPathResult>;

export const FileStat = z.object({
  is_dir: z.boolean(),
  mtime: z.number(),
  size: z.number(),
});
export type FileStat = z.infer<typeof FileStat>;

/** A directory on the host, for the remote project picker. */
export const HostDirectoryEntry = z.object({
  /** True when the directory looks like a git repo — a candidate project root. */
  is_repo: z.boolean(),
  name: z.string(),
  path: z.string(),
});
export type HostDirectoryEntry = z.infer<typeof HostDirectoryEntry>;

export const HostDirectoryListing = z.object({
  entries: z.array(HostDirectoryEntry),
  /** The host's home directory, for a "start over" affordance. */
  home: z.string(),
  /** Absolute parent path, or null at the filesystem root. */
  parent: z.string().nullable(),
  path: z.string(),
});
export type HostDirectoryListing = z.infer<typeof HostDirectoryListing>;

/** Where a client-side file landed after being uploaded to the host. */
export const UploadedAttachment = z.object({
  name: z.string(),
  /** Absolute path on the host. */
  path: z.string(),
  size: z.number(),
});
export type UploadedAttachment = z.infer<typeof UploadedAttachment>;

/** What sits at a path, for a remote git runner. */
export const PathKind = z.object({ kind: z.enum(["file", "directory"]) });
export type PathKind = z.infer<typeof PathKind>;
