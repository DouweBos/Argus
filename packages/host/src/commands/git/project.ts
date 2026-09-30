import { defineTypedCommand } from "../../services/command/registry";
import { reconfigureRepoAutoFetch } from "../../services/session/autoFetch";
import { loadCommandMetrics } from "../../services/session/commandMetrics";
import {
  getSessionReleaseNotes,
  previewReleaseNotes,
} from "../../services/session/releaseNotes";
import {
  getSessionCommitsAhead,
  getSessionCommitsBehind,
  getSessionConflicts,
  getSessionMergeBlockers,
  mergeSessionIntoBase,
  pushSessionBranch,
  readArgusConfig,
  rebaseSessionOnBase,
  setSessionBaseBranch,
  writeArgusConfig,
} from "../../services/session/sessionOps";
import {
  executeWorktreeMove,
  planWorktreeMove,
} from "../../services/session/worktreeMove";
import {
  defaultWorktreesBase,
  getWorktreeStorage,
  probeWorktreeLocation,
} from "../../services/session/worktreeStorage";
import {
  loadUserProjectSettings,
  saveUserProjectSettings,
} from "../../services/userProjectSettings/store";

export function registerGitProjectCommands(): void {
  defineTypedCommand("read_argus_config", (p) => readArgusConfig(p.repoRoot));
  defineTypedCommand("write_argus_config", (p) =>
    writeArgusConfig(p.repoRoot, p.content),
  );
  defineTypedCommand("get_user_project_settings", (p) =>
    loadUserProjectSettings(p.repoRoot),
  );
  defineTypedCommand("set_user_project_settings", (p) =>
    saveUserProjectSettings(p.repoRoot, p.settings),
  );
  defineTypedCommand("plan_worktrees_move", (p) =>
    planWorktreeMove(p.repoRoot, p.toBaseDir, p.purpose),
  );
  defineTypedCommand("move_worktrees", (p) =>
    executeWorktreeMove(p.repoRoot, p.toBaseDir, p.purpose),
  );
  defineTypedCommand("get_worktrees_default_base", () =>
    defaultWorktreesBase(),
  );
  defineTypedCommand("get_worktree_storage", (p) =>
    getWorktreeStorage(p.repoRoot),
  );
  defineTypedCommand("probe_worktree_location", (p) =>
    probeWorktreeLocation(p.baseDir, p.repoRoot),
  );
  defineTypedCommand("get_command_metrics", (p) =>
    loadCommandMetrics(p.repoRoot),
  );
  defineTypedCommand("git_reconfigure_auto_fetch", (p) =>
    reconfigureRepoAutoFetch(p.repoRoot, p.minutes),
  );
  defineTypedCommand("set_session_base_branch", (p) =>
    setSessionBaseBranch(p.id, p.baseBranch),
  );
  defineTypedCommand("get_session_conflicts", (p) => getSessionConflicts(p.id));
  defineTypedCommand("get_session_merge_blockers", (p) =>
    getSessionMergeBlockers(p.id),
  );
  defineTypedCommand("get_session_release_notes", (p) =>
    getSessionReleaseNotes(p.id),
  );
  defineTypedCommand("preview_release_notes", (p) =>
    previewReleaseNotes(p.repoRoot, p.patterns),
  );
  defineTypedCommand("get_session_commits_ahead", (p) =>
    getSessionCommitsAhead(p.id),
  );
  defineTypedCommand("get_session_commits_behind", (p) =>
    getSessionCommitsBehind(p.id),
  );
  defineTypedCommand("merge_session_into_base", (p) =>
    mergeSessionIntoBase(p.id, p.strategy),
  );
  defineTypedCommand("rebase_session_on_base", (p) =>
    rebaseSessionOnBase(p.id),
  );
  defineTypedCommand("push_session_branch", (p) => pushSessionBranch(p.id));
}
