import { defineTypedCommand } from "../../services/command/registry";
import { gitAmendTip } from "../../services/session/gitAmend";
import {
  gitAbortCherryPick,
  gitAbortMerge,
  gitAbortRebase,
  gitContinueCherryPick,
  gitContinueMerge,
  gitContinueRebase,
  gitGetConflict,
  gitMarkResolved,
  gitSkipRebase,
  gitWriteConflictMerged,
} from "../../services/session/gitConflicts";
import {
  addToGitignore,
  gitDiscardFile,
  gitDiscardHunk,
  gitDiscardLines,
  gitUntrackFile,
} from "../../services/session/gitDiscard";
import { gitStatus } from "../../services/session/gitStatus";
import {
  gitListAssumeUnchangedFiles,
  gitListIgnoredFiles,
} from "../../services/session/gitWorkingCopyFilters";
import {
  discardFile,
  discardHunk,
  getGitAuthor,
  getLastCommitHash,
  getLastCommitMessage,
  getSessionBranchDiff,
  getSessionDiff,
  getSessionFullDiff,
  getSessionStagedDiff,
  getSessionStatus,
  getSessionUntrackedDiff,
  gitCheckoutPaths,
  gitCommit,
  pauseAllWatchers,
  resumeAllWatchers,
  stageAll,
  stageFile,
  stageHunk,
  unstageAll,
  unstageFile,
  unstageHunk,
  unwatchSession,
  watchSession,
} from "../../services/session/sessionOps";

export function registerGitWorkingCopyCommands(): void {
  defineTypedCommand("get_session_diff", (p) => getSessionDiff(p.id));
  defineTypedCommand("get_session_full_diff", (p) => getSessionFullDiff(p.id));
  defineTypedCommand("get_session_branch_diff", ({ id, ...opts }) =>
    getSessionBranchDiff(id, opts),
  );
  defineTypedCommand("get_session_staged_diff", ({ id, ...opts }) =>
    getSessionStagedDiff(id, opts),
  );
  defineTypedCommand("get_session_untracked_diff", (p) =>
    getSessionUntrackedDiff(p.id),
  );
  defineTypedCommand("get_session_status", (p) => getSessionStatus(p.id));
  defineTypedCommand("git_status", (p) => gitStatus(p.id));
  defineTypedCommand("git_list_ignored_files", (p) =>
    gitListIgnoredFiles(p.id),
  );
  defineTypedCommand("git_list_assume_unchanged_files", (p) =>
    gitListAssumeUnchangedFiles(p.id),
  );
  defineTypedCommand("stage_file", (p) => stageFile(p.id, p.filePath));
  defineTypedCommand("stage_all", (p) => stageAll(p.id));
  defineTypedCommand("unstage_file", (p) => unstageFile(p.id, p.filePath));
  defineTypedCommand("unstage_all", (p) => unstageAll(p.id));
  defineTypedCommand("discard_file", (p) => discardFile(p.id, p.filePath));
  defineTypedCommand("stage_hunk", (p) => stageHunk(p.id, p.patch));
  defineTypedCommand("unstage_hunk", (p) => unstageHunk(p.id, p.patch));
  defineTypedCommand("discard_hunk", (p) =>
    discardHunk(p.id, p.patch, p.staged),
  );
  defineTypedCommand("git_commit", (p) => gitCommit(p.id, p.message, p.amend));
  defineTypedCommand("get_git_author", (p) => getGitAuthor(p.id));
  defineTypedCommand("get_last_commit_message", (p) =>
    getLastCommitMessage(p.id),
  );
  defineTypedCommand("get_last_commit_hash", (p) => getLastCommitHash(p.id));
  defineTypedCommand("watch_session", (p) => watchSession(p.id));
  defineTypedCommand("unwatch_session", (p) => unwatchSession(p.id));
  defineTypedCommand("pause_all_watchers", () => pauseAllWatchers());
  defineTypedCommand("resume_all_watchers", () => resumeAllWatchers());
  defineTypedCommand("git_checkout_paths", (p) =>
    gitCheckoutPaths(p.id, p.ref, p.paths),
  );
  defineTypedCommand("git_discard_file", (p) =>
    gitDiscardFile(p.id, p.filePath),
  );
  defineTypedCommand("git_discard_hunk", (p) =>
    gitDiscardHunk(p.id, p.hunkPatch),
  );
  defineTypedCommand("git_discard_lines", (p) =>
    gitDiscardLines(p.id, p.filePath, p.lines, p.side, p.hunkPatch),
  );
  defineTypedCommand("git_untrack_file", (p) =>
    gitUntrackFile(p.id, p.filePath),
  );
  defineTypedCommand("add_to_gitignore", (p) =>
    addToGitignore(p.id, p.filePath),
  );
  defineTypedCommand("git_continue_merge", (p) => gitContinueMerge(p.id));
  defineTypedCommand("git_abort_merge", (p) => gitAbortMerge(p.id));
  defineTypedCommand("git_continue_rebase", (p) => gitContinueRebase(p.id));
  defineTypedCommand("git_abort_rebase", (p) => gitAbortRebase(p.id));
  defineTypedCommand("git_skip_rebase", (p) => gitSkipRebase(p.id));
  defineTypedCommand("git_continue_cherry_pick", (p) =>
    gitContinueCherryPick(p.id),
  );
  defineTypedCommand("git_abort_cherry_pick", (p) => gitAbortCherryPick(p.id));
  defineTypedCommand("git_get_conflict", (p) =>
    gitGetConflict(p.id, p.filePath),
  );
  defineTypedCommand("git_mark_resolved", (p) =>
    gitMarkResolved(p.id, p.filePath),
  );
  defineTypedCommand("git_write_conflict_merged", (p) =>
    gitWriteConflictMerged(p.id, p.filePath, p.contents),
  );
  defineTypedCommand("git_amend_tip", (p) =>
    gitAmendTip(p.id, p.subject, p.body),
  );
}
