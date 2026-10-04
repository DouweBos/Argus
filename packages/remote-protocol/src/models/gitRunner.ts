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

export const GitRunnerRunResult = z.object({
  exitCode: z.number(),
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
