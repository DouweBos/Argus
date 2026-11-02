import { z } from "zod";
import { ConflictBlobs, GitStatus } from "../../models/git";
import { type CommandSpec, NoParams, Void } from "../spec";
import { SessionFilePath, SessionId } from "./shared";

const DiffView = SessionId.extend({
  ignoreWhitespace: z.boolean().optional(),
  wordDiff: z.boolean().optional(),
});
const SessionPatch = SessionId.extend({ patch: z.string() });

export const GIT_WORKING_COPY_COMMANDS = {
  get_session_diff: { tier: "admin", params: SessionId, result: z.string() },
  get_session_full_diff: {
    tier: "admin",
    params: SessionId,
    result: z.string(),
  },
  get_session_branch_diff: {
    tier: "admin",
    params: DiffView,
    result: z.string(),
  },
  get_session_staged_diff: {
    tier: "admin",
    params: DiffView,
    result: z.string(),
  },
  get_session_untracked_diff: {
    tier: "admin",
    params: SessionId,
    result: z.string(),
  },
  get_session_status: { tier: "admin", params: SessionId, result: z.string() },
  git_status: { tier: "admin", params: SessionId, result: GitStatus },
  stage_file: { tier: "admin", params: SessionFilePath, result: Void },
  stage_all: { tier: "admin", params: SessionId, result: Void },
  unstage_file: { tier: "admin", params: SessionFilePath, result: Void },
  unstage_all: { tier: "admin", params: SessionId, result: Void },
  discard_file: { tier: "admin", params: SessionFilePath, result: Void },
  stage_hunk: { tier: "admin", params: SessionPatch, result: Void },
  unstage_hunk: { tier: "admin", params: SessionPatch, result: Void },
  discard_hunk: {
    tier: "admin",
    params: SessionPatch.extend({ staged: z.boolean().default(false) }),
    result: Void,
  },
  /** Resolves with git's commit output. */
  git_commit: {
    tier: "admin",
    params: SessionId.extend({
      message: z.string(),
      amend: z.boolean().default(false),
    }),
    result: z.string(),
  },
  /** `[name, email]`. */
  get_git_author: {
    tier: "admin",
    params: SessionId,
    result: z.tuple([z.string(), z.string()]),
  },
  get_last_commit_message: {
    tier: "admin",
    params: SessionId,
    result: z.string(),
  },
  get_last_commit_hash: {
    tier: "admin",
    params: SessionId,
    result: z.string(),
  },
  watch_session: { tier: "admin", params: SessionId, result: Void },
  unwatch_session: { tier: "admin", params: SessionId, result: Void },
  pause_all_watchers: { tier: "admin", params: NoParams, result: Void },
  resume_all_watchers: { tier: "admin", params: NoParams, result: Void },
  git_checkout_paths: {
    tier: "admin",
    params: SessionId.extend({ ref: z.string(), paths: z.array(z.string()) }),
    result: z.string(),
  },
  git_discard_file: { tier: "admin", params: SessionFilePath, result: Void },
  git_discard_hunk: {
    tier: "admin",
    params: SessionId.extend({ hunkPatch: z.string() }),
    result: Void,
  },
  git_discard_lines: {
    tier: "admin",
    params: SessionFilePath.extend({
      lines: z.array(z.number()).default([]),
      side: z.enum(["new", "old"]).default("new"),
      hunkPatch: z.string(),
    }),
    result: Void,
  },
  git_untrack_file: { tier: "admin", params: SessionFilePath, result: Void },
  add_to_gitignore: { tier: "admin", params: SessionFilePath, result: Void },
  git_continue_merge: { tier: "admin", params: SessionId, result: Void },
  git_abort_merge: { tier: "admin", params: SessionId, result: Void },
  git_continue_rebase: { tier: "admin", params: SessionId, result: Void },
  git_abort_rebase: { tier: "admin", params: SessionId, result: Void },
  git_skip_rebase: { tier: "admin", params: SessionId, result: Void },
  git_continue_cherry_pick: { tier: "admin", params: SessionId, result: Void },
  git_abort_cherry_pick: { tier: "admin", params: SessionId, result: Void },
  git_get_conflict: {
    tier: "admin",
    params: SessionFilePath,
    result: ConflictBlobs,
  },
  git_mark_resolved: { tier: "admin", params: SessionFilePath, result: Void },
  git_write_conflict_merged: {
    tier: "admin",
    params: SessionFilePath.extend({ contents: z.string() }),
    result: Void,
  },
  git_amend_tip: {
    tier: "admin",
    params: SessionId.extend({ subject: z.string(), body: z.string() }),
    result: z.string(),
  },
} as const satisfies Record<string, CommandSpec>;
