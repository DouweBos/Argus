import { z } from "zod";
import {
  CreatedPullRequest,
  GhIssue,
  InterestingPullRequest,
  PullRequestDetail,
  PullRequestMergeStrategy,
} from "../models/github";
import { type CommandSpec, Void } from "./spec";

const PullRequestRef = z.object({
  owner: z.string(),
  repo: z.string(),
  number: z.number(),
});
const RepoRoot = z.object({ repoRoot: z.string() });

export const GITHUB_COMMANDS = {
  list_interesting_pull_requests: {
    tier: "admin",
    params: z.object({ repoRoots: z.array(z.string()).default([]) }),
    result: z.array(InterestingPullRequest),
  },
  get_pull_request_detail: {
    tier: "admin",
    params: PullRequestRef,
    result: PullRequestDetail,
  },
  /** The unified diff as `gh pr diff` prints it. */
  get_pull_request_diff: {
    tier: "admin",
    params: PullRequestRef,
    result: z.string(),
  },
  /** Null when the repo has no PR template. */
  read_pr_template: {
    tier: "admin",
    params: RepoRoot,
    result: z.string().nullable(),
  },
  /** Null when Claude could not fill the template. */
  autofill_pr_template: {
    tier: "admin",
    params: z.object({
      sessionId: z.string(),
      title: z.string(),
      baseBranch: z.string(),
    }),
    result: z.string().nullable(),
  },
  gh_pr_create: {
    tier: "admin",
    params: RepoRoot.extend({
      title: z.string(),
      body: z.string(),
      base: z.string(),
      head: z.string(),
      draft: z.boolean().default(false),
    }),
    result: CreatedPullRequest,
  },
  gh_pr_comment: {
    tier: "admin",
    params: PullRequestRef.extend({ body: z.string() }),
    result: Void,
  },
  gh_pr_merge: {
    tier: "admin",
    params: PullRequestRef.extend({ strategy: PullRequestMergeStrategy }),
    result: Void,
  },
  gh_pr_close: { tier: "admin", params: PullRequestRef, result: Void },
  /** Empty when `gh` is missing or not authenticated. */
  gh_list_issues: {
    tier: "admin",
    params: RepoRoot,
    result: z.array(GhIssue),
  },
} as const satisfies Record<string, CommandSpec>;
