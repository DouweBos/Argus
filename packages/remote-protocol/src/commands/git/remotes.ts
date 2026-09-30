import { z } from "zod";
import {
  GitHook,
  GitHookOutput,
  GitRemote,
  GitRemoteRich,
  GitSubmodule,
  GitWorktree,
  LfsFiles,
  PullV2Opts,
  PushV2Opts,
  RecentIssue,
  SshKey,
} from "../../models/git";
import { type CommandSpec, NoParams, Void } from "../spec";
import { SessionId } from "./shared";

const SessionName = SessionId.extend({ name: z.string() });

export const GIT_REMOTE_COMMANDS = {
  /** Each resolves with git's output. */
  git_pull: {
    tier: "admin",
    params: SessionId.extend({
      remoteBranch: z.string().optional(),
      rebase: z.boolean().optional(),
    }),
    result: z.string(),
  },
  git_push: { tier: "admin", params: SessionId, result: z.string() },
  git_fetch: { tier: "admin", params: SessionId, result: z.string() },
  git_push_v2: {
    tier: "admin",
    params: SessionId.extend(PushV2Opts.shape),
    result: z.string(),
  },
  git_pull_v2: {
    tier: "admin",
    params: SessionId.extend(PullV2Opts.shape),
    result: z.string(),
  },
  git_get_remotes: {
    tier: "admin",
    params: SessionId,
    result: z.array(GitRemote),
  },
  git_list_remotes: {
    tier: "admin",
    params: SessionId,
    result: z.array(GitRemoteRich),
  },
  git_add_remote: {
    tier: "admin",
    params: SessionName.extend({ url: z.string() }),
    result: Void,
  },
  git_remove_remote: { tier: "admin", params: SessionName, result: Void },
  git_rename_remote: {
    tier: "admin",
    params: SessionId.extend({ from: z.string(), to: z.string() }),
    result: Void,
  },
  git_set_remote_url: {
    tier: "admin",
    params: SessionName.extend({
      url: z.string(),
      push: z.boolean().optional(),
    }),
    result: Void,
  },
  git_prune_remote: { tier: "admin", params: SessionName, result: Void },
  git_list_recent_issues: {
    tier: "admin",
    params: SessionId.extend({ query: z.string().default("") }),
    result: z.array(RecentIssue),
  },
  git_get_config: {
    tier: "admin",
    params: SessionId.extend({ key: z.string() }),
    result: z.string().nullable(),
  },
  git_set_config: {
    tier: "admin",
    params: SessionId.extend({ key: z.string(), value: z.string() }),
    result: Void,
  },
  git_submodule_list: {
    tier: "admin",
    params: SessionId,
    result: z.array(GitSubmodule),
  },
  git_submodule_init: {
    tier: "admin",
    params: SessionId.extend({ path: z.string().optional() }),
    result: Void,
  },
  git_submodule_update: {
    tier: "admin",
    params: SessionId.extend({
      path: z.string().optional(),
      remote: z.boolean().optional(),
    }),
    result: Void,
  },
  git_submodule_deinit: {
    tier: "admin",
    params: SessionId.extend({
      path: z.string(),
      force: z.boolean().optional(),
    }),
    result: Void,
  },
  git_worktree_list: {
    tier: "admin",
    params: SessionId,
    result: z.array(GitWorktree),
  },
  check_ssh_keys: {
    tier: "admin",
    params: NoParams,
    result: z.object({ keys: z.array(SshKey) }),
  },
  get_global_credential_helper: {
    tier: "admin",
    params: NoParams,
    result: z.string().nullable(),
  },
  set_global_credential_helper: {
    tier: "admin",
    params: z.object({ name: z.enum(["osxkeychain", "store"]) }),
    result: Void,
  },
  git_lfs_files: { tier: "admin", params: SessionId, result: LfsFiles },
  git_lfs_pull: {
    tier: "admin",
    params: SessionId.extend({ paths: z.array(z.string()).optional() }),
    result: Void,
  },
  git_list_hooks: {
    tier: "admin",
    params: SessionId,
    result: z.array(GitHook),
  },
  git_run_hook: {
    tier: "admin",
    params: SessionName,
    result: GitHookOutput,
  },
} as const satisfies Record<string, CommandSpec>;
