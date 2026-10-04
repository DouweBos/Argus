/**
 * The host half of a remote `GitRunner`: a client running its own git engine
 * against a session on this host spawns git and touches the repo through
 * these. Effectively shell access, so admin only — like terminals.
 */

import { z } from "zod";
import {
  GitRunnerInfo,
  GitRunnerOutputChunk,
  GitRunnerRunResult,
} from "../models/gitRunner";
import { type CommandSpec, Void } from "./spec";

export const GIT_RUNNER_COMMANDS = {
  git_runner_info: {
    tier: "admin",
    params: z.object({ sessionId: z.string() }),
    result: GitRunnerInfo,
  },
  /**
   * Spawns `git` (no shell). Stderr streams as `git-runner:progress:<runId>`
   * when `runId` is set; subscribe to scope `git-runner:<runId>` first.
   */
  git_runner_run: {
    tier: "admin",
    params: z.object({
      sessionId: z.string(),
      args: z.array(z.string()),
      /** Absolute; defaults to the worktree. */
      cwd: z.string().optional(),
      env: z.record(z.string(), z.string()).optional(),
      /** Base64. */
      stdin: z.string().optional(),
      runId: z.string().optional(),
    }),
    result: GitRunnerRunResult,
  },
  git_runner_output: {
    tier: "admin",
    params: z.object({ outputId: z.string(), offset: z.number() }),
    result: GitRunnerOutputChunk,
  },
  git_runner_cancel: {
    tier: "admin",
    params: z.object({ runId: z.string() }),
    result: Void,
  },
} as const satisfies Record<string, CommandSpec>;
