import { defineTypedCommand } from "../../services/command/registry";
import { branchPullRequestUrl } from "../../services/github/branchPrUrl";
import {
  gitCheckout,
  gitCreateBranch,
  gitDeleteBranch,
  gitDiscardAndCheckout,
  gitListLocalBranches,
  gitListRemoteBranches,
  gitMergeBranch,
  gitRebaseOnto,
  gitRenameBranch,
  gitSetUpstream,
  gitStashAndCheckout,
} from "../../services/session/gitBranchOps";
import { gitCompareBranches } from "../../services/session/gitCompare";
import {
  checkoutBranch,
  getRepoBranch,
  listAllBranches,
  listBranches,
} from "../../services/session/sessionOps";
import {
  archiveBranch,
  listArchivedBranches,
  listPinnedBranches,
  pinBranch,
  unarchiveBranch,
  unpinBranch,
} from "../../services/userProjectSettings/store";

export function registerGitBranchCommands(): void {
  defineTypedCommand("get_repo_branch", (p) => getRepoBranch(p.repoRoot));
  defineTypedCommand("list_branches", (p) => listBranches(p.repoRoot));
  defineTypedCommand("list_all_branches", (p) => listAllBranches(p.repoRoot));
  defineTypedCommand("checkout_branch", (p) =>
    checkoutBranch(p.repoRoot, p.branch),
  );
  defineTypedCommand("git_list_local_branches", (p) =>
    gitListLocalBranches(p.id),
  );
  defineTypedCommand("git_list_remote_branches", (p) =>
    gitListRemoteBranches(p.id),
  );
  defineTypedCommand("git_create_branch", ({ id, ...opts }) =>
    gitCreateBranch(id, opts),
  );
  defineTypedCommand("git_branch_pr_url", (p) =>
    branchPullRequestUrl(p.id, p.branch),
  );
  defineTypedCommand("git_delete_branch", ({ id, ...opts }) =>
    gitDeleteBranch(id, opts),
  );
  defineTypedCommand("git_rename_branch", ({ id, ...opts }) =>
    gitRenameBranch(id, opts),
  );
  defineTypedCommand("git_checkout", ({ id, ...opts }) =>
    gitCheckout(id, opts),
  );
  defineTypedCommand("git_set_upstream", ({ id, ...opts }) =>
    gitSetUpstream(id, opts),
  );
  defineTypedCommand("git_merge_branch", ({ id, ...opts }) =>
    gitMergeBranch(id, opts),
  );
  defineTypedCommand("git_stash_and_checkout", (p) =>
    gitStashAndCheckout(p.id, { branch: p.branch }),
  );
  defineTypedCommand("git_discard_and_checkout", (p) =>
    gitDiscardAndCheckout(p.id, { branch: p.branch }),
  );
  defineTypedCommand("git_rebase_onto", ({ id, ...opts }) =>
    gitRebaseOnto(id, opts),
  );
  defineTypedCommand("git_archive_branch", (p) =>
    archiveBranch(p.repoRoot, p.branch),
  );
  defineTypedCommand("git_unarchive_branch", (p) =>
    unarchiveBranch(p.repoRoot, p.branch),
  );
  defineTypedCommand("git_list_archived_branches", (p) =>
    listArchivedBranches(p.repoRoot),
  );
  defineTypedCommand("git_pin_branch", (p) => pinBranch(p.repoRoot, p.branch));
  defineTypedCommand("git_unpin_branch", (p) =>
    unpinBranch(p.repoRoot, p.branch),
  );
  defineTypedCommand("git_list_pinned_branches", (p) =>
    listPinnedBranches(p.repoRoot),
  );
  defineTypedCommand("git_compare_branches", (p) =>
    gitCompareBranches(p.sessionId, { left: p.left, right: p.right }),
  );
}
