import { z } from "zod";
import {
  BisectStatus,
  BisectStep,
  BlameChunk,
  FormatPatchResult,
  GitCommit,
  GitDiffRangeResult,
  GitStashEntry,
  GitStashSaveOptions,
  GitTag,
  LogSearchFilters,
  LogSearchResult,
  RebasePlanCommit,
  RebasePlanEntry,
  ReflogEntry,
  ReflogOptions,
} from "../../models/git";
import { type CommandSpec, Void } from "../spec";
import { SessionId } from "./shared";

const StashIndex = SessionId.extend({ stashIndex: z.number() });
const Upstream = SessionId.extend({ upstream: z.string() });
const CommitsRef = SessionId.extend({
  hash: z.string(),
  noCommit: z.boolean().optional(),
});

export const GIT_HISTORY_COMMANDS = {
  git_log: {
    tier: "admin",
    params: SessionId.extend({
      count: z.number().default(100),
      allBranches: z.boolean().default(true),
    }),
    result: z.array(GitCommit),
  },
  git_show_commit: {
    tier: "admin",
    params: SessionId.extend({ commitHash: z.string() }),
    result: z.string(),
  },
  git_stash: { tier: "admin", params: SessionId, result: z.string() },
  git_stash_save: {
    tier: "admin",
    params: SessionId.extend(GitStashSaveOptions.shape),
    result: z.string(),
  },
  git_stash_branch: {
    tier: "admin",
    params: SessionId.extend({ stashRef: z.string(), branchName: z.string() }),
    result: z.string(),
  },
  git_stash_pop: { tier: "admin", params: SessionId, result: z.string() },
  git_stash_list: {
    tier: "admin",
    params: SessionId,
    result: z.array(GitStashEntry),
  },
  git_stash_show: { tier: "admin", params: StashIndex, result: z.string() },
  git_stash_apply: { tier: "admin", params: StashIndex, result: z.string() },
  git_stash_drop: { tier: "admin", params: StashIndex, result: z.string() },
  git_search_log: {
    tier: "admin",
    params: SessionId.extend(LogSearchFilters.shape),
    result: LogSearchResult,
  },
  git_diff_range: {
    tier: "admin",
    params: SessionId.extend({ fromRef: z.string(), toRef: z.string() }),
    result: GitDiffRangeResult,
  },
  git_file_history: {
    tier: "admin",
    params: SessionId.extend({ path: z.string() }),
    result: z.array(GitCommit),
  },
  git_blame_file: {
    tier: "admin",
    params: SessionId.extend({ path: z.string(), ref: z.string().optional() }),
    result: z.array(BlameChunk),
  },
  /** Base64 bytes of a file at a ref; `ref: "WORKTREE"` reads the disk. */
  git_read_blob_at_ref: {
    tier: "admin",
    params: SessionId.extend({ path: z.string(), ref: z.string() }),
    result: z.string(),
  },
  git_reflog: {
    tier: "admin",
    params: SessionId.extend(ReflogOptions.shape),
    result: z.array(ReflogEntry),
  },
  git_list_tags: { tier: "admin", params: SessionId, result: z.array(GitTag) },
  git_create_tag: {
    tier: "admin",
    params: SessionId.extend({
      name: z.string(),
      ref: z.string().optional(),
      message: z.string().optional(),
      sign: z.boolean().optional(),
      force: z.boolean().optional(),
    }),
    result: Void,
  },
  git_delete_tag: {
    tier: "admin",
    params: SessionId.extend({ name: z.string() }),
    result: Void,
  },
  git_push_tag: {
    tier: "admin",
    params: SessionId.extend({
      name: z.string().optional(),
      all: z.boolean().optional(),
      remote: z.string().optional(),
    }),
    result: Void,
  },
  git_reset: {
    tier: "admin",
    params: SessionId.extend({
      ref: z.string(),
      mode: z.enum(["hard", "mixed", "soft"]),
    }),
    result: Void,
  },
  git_revert: { tier: "admin", params: CommitsRef, result: Void },
  git_cherry_pick: {
    tier: "admin",
    params: CommitsRef.extend({
      hash: z.union([z.array(z.string()), z.string()]),
    }),
    result: Void,
  },
  git_rebase_interactive_plan: {
    tier: "admin",
    params: Upstream,
    result: z.array(RebasePlanCommit),
  },
  git_rebase_interactive_run: {
    tier: "admin",
    params: Upstream.extend({ plan: z.array(RebasePlanEntry) }),
    result: Void,
  },
  git_rebase_autosquash: { tier: "admin", params: Upstream, result: Void },
  git_bisect_start: {
    tier: "admin",
    params: SessionId.extend({ goodRef: z.string(), badRef: z.string() }),
    result: BisectStep,
  },
  git_bisect_good: { tier: "admin", params: SessionId, result: BisectStep },
  git_bisect_bad: { tier: "admin", params: SessionId, result: BisectStep },
  git_bisect_skip: { tier: "admin", params: SessionId, result: BisectStep },
  git_bisect_reset: { tier: "admin", params: SessionId, result: Void },
  git_bisect_status: { tier: "admin", params: SessionId, result: BisectStatus },
  git_format_patch: {
    tier: "admin",
    params: SessionId.extend({
      range: z.string(),
      outputDir: z.string().optional(),
    }),
    result: FormatPatchResult,
  },
  git_am: {
    tier: "admin",
    params: SessionId.extend({ patchPaths: z.array(z.string()) }),
    result: Void,
  },
} as const satisfies Record<string, CommandSpec>;
