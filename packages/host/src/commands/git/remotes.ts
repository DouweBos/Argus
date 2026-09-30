import { defineTypedCommand } from "../../services/command/registry";
import { gitGetConfig, gitSetConfig } from "../../services/session/gitConfig";
import {
  checkSshKeys,
  getGlobalCredentialHelper,
  setGlobalCredentialHelper,
} from "../../services/session/gitCredentials";
import { gitListHooks, gitRunHook } from "../../services/session/gitHooks";
import { gitLfsFiles, gitLfsPull } from "../../services/session/gitLfs";
import { gitPullV2, gitPushV2 } from "../../services/session/gitPushPull";
import {
  gitAddRemote,
  gitListRemotes,
  gitPruneRemote,
  gitRemoveRemote,
  gitRenameRemote,
  gitSetRemoteUrl,
} from "../../services/session/gitRemoteOps";
import {
  gitGetRemotes,
  gitListRecentIssues,
} from "../../services/session/gitRemotes";
import {
  gitSubmoduleDeinit,
  gitSubmoduleInit,
  gitSubmoduleList,
  gitSubmoduleUpdate,
} from "../../services/session/gitSubmodules";
import { gitWorktreeList } from "../../services/session/gitWorktrees";
import { gitFetch, gitPull, gitPush } from "../../services/session/sessionOps";

export function registerGitRemoteCommands(): void {
  defineTypedCommand("git_pull", (p) =>
    gitPull(p.id, p.remoteBranch, p.rebase),
  );
  defineTypedCommand("git_push", (p) => gitPush(p.id));
  defineTypedCommand("git_fetch", (p) => gitFetch(p.id));
  defineTypedCommand("git_push_v2", ({ id, ...opts }) => gitPushV2(id, opts));
  defineTypedCommand("git_pull_v2", ({ id, ...opts }) => gitPullV2(id, opts));
  defineTypedCommand("git_get_remotes", (p) => gitGetRemotes(p.id));
  defineTypedCommand("git_list_remotes", (p) => gitListRemotes(p.id));
  defineTypedCommand("git_add_remote", ({ id, ...opts }) =>
    gitAddRemote(id, opts),
  );
  defineTypedCommand("git_remove_remote", (p) =>
    gitRemoveRemote(p.id, { name: p.name }),
  );
  defineTypedCommand("git_rename_remote", ({ id, ...opts }) =>
    gitRenameRemote(id, opts),
  );
  defineTypedCommand("git_set_remote_url", ({ id, ...opts }) =>
    gitSetRemoteUrl(id, opts),
  );
  defineTypedCommand("git_prune_remote", (p) =>
    gitPruneRemote(p.id, { name: p.name }),
  );
  defineTypedCommand("git_list_recent_issues", (p) =>
    gitListRecentIssues(p.id, p.query),
  );
  defineTypedCommand("git_get_config", (p) => gitGetConfig(p.id, p.key));
  defineTypedCommand("git_set_config", (p) =>
    gitSetConfig(p.id, p.key, p.value),
  );
  defineTypedCommand("git_submodule_list", (p) => gitSubmoduleList(p.id));
  defineTypedCommand("git_submodule_init", ({ id, ...opts }) =>
    gitSubmoduleInit(id, opts),
  );
  defineTypedCommand("git_submodule_update", ({ id, ...opts }) =>
    gitSubmoduleUpdate(id, opts),
  );
  defineTypedCommand("git_submodule_deinit", ({ id, ...opts }) =>
    gitSubmoduleDeinit(id, opts),
  );
  defineTypedCommand("git_worktree_list", (p) => gitWorktreeList(p.id));
  defineTypedCommand("check_ssh_keys", () => checkSshKeys());
  defineTypedCommand("get_global_credential_helper", () =>
    getGlobalCredentialHelper(),
  );
  defineTypedCommand("set_global_credential_helper", (p) =>
    setGlobalCredentialHelper(p.name),
  );
  defineTypedCommand("git_lfs_files", (p) => gitLfsFiles(p.id));
  defineTypedCommand("git_lfs_pull", ({ id, ...opts }) => gitLfsPull(id, opts));
  defineTypedCommand("git_list_hooks", (p) => gitListHooks(p.id));
  defineTypedCommand("git_run_hook", (p) => gitRunHook(p.id, { name: p.name }));
}
