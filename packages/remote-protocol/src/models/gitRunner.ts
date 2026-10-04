import { z } from "zod";

/** Where a remote git runner works for one session — absolute, canonical. */
export const GitRunnerInfo = z.object({
  commonGitDir: z.string(),
  gitDir: z.string(),
  /** `<gitDir>/argus-scratch`: rebase todos, editor scripts, temp indexes. */
  scratchDir: z.string(),
  worktree: z.string(),
});
export type GitRunnerInfo = z.infer<typeof GitRunnerInfo>;

/** What a failed git run ran into, classified the way the desktop's banner is. */
export const GitFailureKind = z.enum([
  "auth-required",
  "branch-checked-out",
  "busy",
  "cherry-pick-conflict",
  "detached-head",
  "dirty-working-tree",
  "hook-failed",
  "lfs-missing",
  "lock-file-exists",
  "merge-conflict",
  "network-timeout",
  "no-upstream",
  "non-fast-forward",
  "nothing-to-commit",
  "nothing-to-pull",
  "nothing-to-push",
  "output-too-large",
  "rebase-conflict",
  "signing-failed",
  "unknown",
]);
export type GitFailureKind = z.infer<typeof GitFailureKind>;

export const GitRecovery = z.enum([
  "configure-signing",
  "install-lfs",
  "publish-branch",
  "pull-then-push",
  "reauthenticate",
  "resolve-conflicts",
  "retry",
  "show-hook-output",
  "stash-and-retry",
]);
export type GitRecovery = z.infer<typeof GitRecovery>;

export const GitRunnerFailure = z.object({
  kind: GitFailureKind,
  /** One line for a banner; the full text is the run's `stderr`. */
  message: z.string(),
  /** The fix git's own output points at, when there is one. */
  recovery: GitRecovery.optional(),
});
export type GitRunnerFailure = z.infer<typeof GitRunnerFailure>;

export const GitRunnerRunResult = z.object({
  exitCode: z.number(),
  /** Set when `exitCode` isn't 0. */
  failure: GitRunnerFailure.optional(),
  /** Set when stdout was too big to inline; page it with `git_runner_output`. */
  outputId: z.string().optional(),
  stderr: z.string(),
  /** Base64; empty when `outputId` is set. */
  stdout: z.string(),
  stdoutBytes: z.number(),
});
export type GitRunnerRunResult = z.infer<typeof GitRunnerRunResult>;

export const GitRunnerOutputChunk = z.object({
  /** Base64. */
  data: z.string(),
  done: z.boolean(),
});
export type GitRunnerOutputChunk = z.infer<typeof GitRunnerOutputChunk>;

/** Payload of `git-runner:progress:<runId>`. */
export const GitRunnerProgress = z.object({ chunk: z.string() });
export type GitRunnerProgress = z.infer<typeof GitRunnerProgress>;
