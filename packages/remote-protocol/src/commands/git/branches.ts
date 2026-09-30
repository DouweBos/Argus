import { z } from "zod";
import {
  BranchList,
  EnrichedBranch,
  GitCompareResult,
  GitRemoteBranch,
} from "../../models/git";
import { type CommandSpec, Void } from "../spec";
import { RepoBranch, RepoRoot, SessionId } from "./shared";

const SessionBranch = SessionId.extend({ branch: z.string() });

export const GIT_BRANCH_COMMANDS = {
  get_repo_branch: { tier: "admin", params: RepoRoot, result: z.string() },
  list_branches: {
    tier: "admin",
    params: RepoRoot,
    result: z.array(z.string()),
  },
  list_all_branches: { tier: "admin", params: RepoRoot, result: BranchList },
  checkout_branch: { tier: "admin", params: RepoBranch, result: Void },
  git_list_local_branches: {
    tier: "admin",
    params: SessionId,
    result: z.array(EnrichedBranch),
  },
  git_list_remote_branches: {
    tier: "admin",
    params: SessionId,
    result: z.array(GitRemoteBranch),
  },
  git_create_branch: {
    tier: "admin",
    params: SessionId.extend({
      name: z.string(),
      startPoint: z.string().optional(),
      checkout: z.boolean().optional(),
    }),
    result: Void,
  },
  /** GitHub's "open a PR" page for a branch, or null without a GitHub remote. */
  git_branch_pr_url: {
    tier: "admin",
    params: SessionBranch,
    result: z.string().nullable(),
  },
  git_delete_branch: {
    tier: "admin",
    params: SessionId.extend({
      name: z.string(),
      force: z.boolean().optional(),
    }),
    result: Void,
  },
  git_rename_branch: {
    tier: "admin",
    params: SessionId.extend({ from: z.string(), to: z.string() }),
    result: Void,
  },
  git_checkout: {
    tier: "admin",
    params: SessionBranch.extend({ create: z.boolean().optional() }),
    result: Void,
  },
  git_set_upstream: {
    tier: "admin",
    params: SessionBranch.extend({ upstream: z.string() }),
    result: Void,
  },
  git_merge_branch: {
    tier: "admin",
    params: SessionId.extend({
      from: z.string(),
      into: z.string().optional(),
      squash: z.boolean().optional(),
    }),
    result: Void,
  },
  /** Stash, check out, pop — the answer to a dirty-tree checkout. */
  git_stash_and_checkout: {
    tier: "admin",
    params: SessionBranch,
    result: Void,
  },
  git_discard_and_checkout: {
    tier: "admin",
    params: SessionBranch,
    result: Void,
  },
  git_rebase_onto: {
    tier: "admin",
    params: SessionId.extend({
      upstream: z.string(),
      branch: z.string().optional(),
    }),
    result: Void,
  },
  /** UI-only archive: git is untouched. Mutations return the new list. */
  git_archive_branch: {
    tier: "admin",
    params: RepoBranch,
    result: z.array(z.string()),
  },
  git_unarchive_branch: {
    tier: "admin",
    params: RepoBranch,
    result: z.array(z.string()),
  },
  git_list_archived_branches: {
    tier: "admin",
    params: RepoRoot,
    result: z.array(z.string()),
  },
  git_pin_branch: {
    tier: "admin",
    params: RepoBranch,
    result: z.array(z.string()),
  },
  git_unpin_branch: {
    tier: "admin",
    params: RepoBranch,
    result: z.array(z.string()),
  },
  git_list_pinned_branches: {
    tier: "admin",
    params: RepoRoot,
    result: z.array(z.string()),
  },
  /** Diverging commits, merge-base and a conflict precheck for two refs. */
  git_compare_branches: {
    tier: "admin",
    params: z.object({
      sessionId: z.string(),
      left: z.string(),
      right: z.string(),
    }),
    result: GitCompareResult,
  },
} as const satisfies Record<string, CommandSpec>;
