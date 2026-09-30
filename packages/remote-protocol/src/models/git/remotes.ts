import { z } from "zod";

export const GitRemote = z.object({ name: z.string(), url: z.string() });
export type GitRemote = z.infer<typeof GitRemote>;

export const RecentIssue = z.object({
  number: z.number(),
  state: z.enum(["closed", "open"]),
  title: z.string(),
});
export type RecentIssue = z.infer<typeof RecentIssue>;

export const RemoteScheme = z.enum(["https", "other", "ssh"]);
export type RemoteScheme = z.infer<typeof RemoteScheme>;

export const GitRemoteRich = z.object({
  name: z.string(),
  fetchUrl: z.string(),
  pushUrl: z.string().optional(),
  refs: z.number(),
  scheme: RemoteScheme,
  host: z.string(),
});
export type GitRemoteRich = z.infer<typeof GitRemoteRich>;

export const GitTag = z.object({
  name: z.string(),
  commitHash: z.string(),
  subject: z.string(),
  isAnnotated: z.boolean(),
  tagger: z
    .object({ name: z.string(), email: z.string(), date: z.string() })
    .optional(),
  message: z.string().optional(),
  /** ISO-strict date the tag was created (annotated tag date or, for
   * lightweight tags, the target commit's committer date). */
  creatorDate: z.string(),
  /** `true` if the tag exists on the default remote, `false` if not, `null` if unknown. */
  pushed: z.boolean().nullable(),
});
export type GitTag = z.infer<typeof GitTag>;

export const SubmoduleStatus = z.enum(["clean", "modified", "uninitialized"]);
export type SubmoduleStatus = z.infer<typeof SubmoduleStatus>;

export const GitSubmodule = z.object({
  name: z.string(),
  path: z.string(),
  url: z.string(),
  commitHash: z.string(),
  status: SubmoduleStatus,
});
export type GitSubmodule = z.infer<typeof GitSubmodule>;

export const GitWorktree = z.object({
  path: z.string(),
  branch: z.string().nullable(),
  head: z.string(),
  isMain: z.boolean(),
  isLocked: z.boolean(),
  lockReason: z.string().optional(),
  isDetached: z.boolean(),
});
export type GitWorktree = z.infer<typeof GitWorktree>;

export const SshKeyType = z.enum(["dsa", "ecdsa", "ed25519", "other", "rsa"]);
export type SshKeyType = z.infer<typeof SshKeyType>;

export const SshKey = z.object({ name: z.string(), type: SshKeyType });
export type SshKey = z.infer<typeof SshKey>;

export const LfsFiles = z.object({
  lfsInstalled: z.boolean(),
  /** True when the repo has tracked files matching `filter=lfs` attributes. */
  repoUsesLfs: z.boolean(),
  tracked: z.array(z.string()),
});
export type LfsFiles = z.infer<typeof LfsFiles>;

export const FormatPatchResult = z.object({ patchPaths: z.array(z.string()) });
export type FormatPatchResult = z.infer<typeof FormatPatchResult>;

export const GitHookOutput = z.object({
  exitCode: z.number(),
  ranAt: z.number(),
  stderr: z.string(),
  stdout: z.string(),
});
export type GitHookOutput = z.infer<typeof GitHookOutput>;

export const GitHook = z.object({
  executable: z.boolean(),
  lastModified: z.number(),
  lastOutput: GitHookOutput.nullable(),
  name: z.string(),
  path: z.string(),
});
export type GitHook = z.infer<typeof GitHook>;

export const PushV2Opts = z.object({
  remote: z.string().optional(),
  branch: z.string().optional(),
  force: z.boolean().optional(),
  forceWithLease: z.boolean().optional(),
  setUpstream: z.boolean().optional(),
  tags: z.enum(["all", "follow", "none"]).optional(),
  ref: z.string().optional(),
});
export type PushV2Opts = z.infer<typeof PushV2Opts>;

export const PullV2Opts = z.object({
  strategy: z.enum(["ff-only", "merge", "rebase"]),
  prune: z.boolean().optional(),
  tags: z.boolean().optional(),
  remote: z.string().optional(),
  branch: z.string().optional(),
});
export type PullV2Opts = z.infer<typeof PullV2Opts>;
