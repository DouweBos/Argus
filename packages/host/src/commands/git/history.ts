import { defineTypedCommand } from "../../services/command/registry";
import {
  gitBisectBad,
  gitBisectGood,
  gitBisectReset,
  gitBisectSkip,
  gitBisectStart,
  gitBisectStatus,
} from "../../services/session/gitBisect";
import { gitBlameFile } from "../../services/session/gitBlame";
import { gitReadBlobAtRef } from "../../services/session/gitBlob";
import {
  gitCherryPick,
  gitReset,
  gitRevert,
} from "../../services/session/gitHistoryOps";
import { gitAm, gitFormatPatch } from "../../services/session/gitPatches";
import {
  gitRebaseAutosquash,
  gitRebaseInteractivePlan,
  gitRebaseInteractiveRun,
} from "../../services/session/gitRebase";
import { gitReflog } from "../../services/session/gitReflog";
import {
  gitDiffRange,
  gitFileHistory,
  gitSearchLog,
} from "../../services/session/gitSearch";
import {
  gitCreateTag,
  gitDeleteTag,
  gitListTags,
  gitPushTag,
} from "../../services/session/gitTags";
import {
  gitLog,
  gitShowCommit,
  gitStash,
  gitStashApply,
  gitStashBranch,
  gitStashDrop,
  gitStashList,
  gitStashPop,
  gitStashSave,
  gitStashShow,
} from "../../services/session/sessionOps";

export function registerGitHistoryCommands(): void {
  defineTypedCommand("git_log", (p) => gitLog(p.id, p.count, p.allBranches));
  defineTypedCommand("git_show_commit", (p) =>
    gitShowCommit(p.id, p.commitHash),
  );
  defineTypedCommand("git_stash", (p) => gitStash(p.id));
  defineTypedCommand("git_stash_save", ({ id, ...options }) =>
    gitStashSave(id, options),
  );
  defineTypedCommand("git_stash_branch", (p) =>
    gitStashBranch(p.id, p.stashRef, p.branchName),
  );
  defineTypedCommand("git_stash_pop", (p) => gitStashPop(p.id));
  defineTypedCommand("git_stash_list", (p) => gitStashList(p.id));
  defineTypedCommand("git_stash_show", (p) => gitStashShow(p.id, p.stashIndex));
  defineTypedCommand("git_stash_apply", (p) =>
    gitStashApply(p.id, p.stashIndex),
  );
  defineTypedCommand("git_stash_drop", (p) => gitStashDrop(p.id, p.stashIndex));
  defineTypedCommand("git_search_log", ({ id, ...filters }) =>
    gitSearchLog(id, filters),
  );
  defineTypedCommand("git_diff_range", (p) =>
    gitDiffRange(p.id, p.fromRef, p.toRef),
  );
  defineTypedCommand("git_file_history", (p) => gitFileHistory(p.id, p.path));
  defineTypedCommand("git_blame_file", (p) =>
    gitBlameFile(p.id, p.path, p.ref),
  );
  defineTypedCommand("git_read_blob_at_ref", (p) =>
    gitReadBlobAtRef(p.id, p.path, p.ref),
  );
  defineTypedCommand("git_reflog", ({ id, ...options }) =>
    gitReflog(id, options),
  );
  defineTypedCommand("git_list_tags", (p) => gitListTags(p.id));
  defineTypedCommand("git_create_tag", ({ id, ...opts }) =>
    gitCreateTag(id, opts),
  );
  defineTypedCommand("git_delete_tag", (p) =>
    gitDeleteTag(p.id, { name: p.name }),
  );
  defineTypedCommand("git_push_tag", ({ id, ...opts }) => gitPushTag(id, opts));
  defineTypedCommand("git_reset", ({ id, ...opts }) => gitReset(id, opts));
  defineTypedCommand("git_revert", ({ id, ...opts }) => gitRevert(id, opts));
  defineTypedCommand("git_cherry_pick", ({ id, ...opts }) =>
    gitCherryPick(id, opts),
  );
  defineTypedCommand("git_rebase_interactive_plan", (p) =>
    gitRebaseInteractivePlan(p.id, { upstream: p.upstream }),
  );
  defineTypedCommand("git_rebase_interactive_run", ({ id, ...opts }) =>
    gitRebaseInteractiveRun(id, opts),
  );
  defineTypedCommand("git_rebase_autosquash", (p) =>
    gitRebaseAutosquash(p.id, { upstream: p.upstream }),
  );
  defineTypedCommand("git_bisect_start", ({ id, ...opts }) =>
    gitBisectStart(id, opts),
  );
  defineTypedCommand("git_bisect_good", (p) => gitBisectGood(p.id));
  defineTypedCommand("git_bisect_bad", (p) => gitBisectBad(p.id));
  defineTypedCommand("git_bisect_skip", (p) => gitBisectSkip(p.id));
  defineTypedCommand("git_bisect_reset", (p) => gitBisectReset(p.id));
  defineTypedCommand("git_bisect_status", (p) => gitBisectStatus(p.id));
  defineTypedCommand("git_format_patch", ({ id, ...opts }) =>
    gitFormatPatch(id, opts),
  );
  defineTypedCommand("git_am", (p) =>
    gitAm(p.id, { patchPaths: p.patchPaths }),
  );
}
