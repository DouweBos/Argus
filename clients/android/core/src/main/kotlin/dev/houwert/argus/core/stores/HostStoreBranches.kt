package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.RemoteCommand
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteBranchCompare
import dev.houwert.argus.kit.protocol.generated.RemoteCommit

// Branches on a project root: history, commits, and everything the desktop's
// branch menu does. Reads are monitor-tier; anything that moves a ref needs `control`.

enum class CheckoutOutcome { Ok, Dirty, Failed }

suspend fun HostStore.checkoutBranch(sessionId: String, repoRoot: String, branch: String, dirty: String? = null): CheckoutOutcome {
  val backend = backend ?: return CheckoutOutcome.Failed
  return try {
    val result = backend.request(
      Methods.SessionsCheckout,
      MethodsTypes.SessionsCheckoutParams(sessionId, branch, dirty?.let { MethodsTypes.SessionsCheckoutParamsDirty(it) }),
    )
    if (result.blockedBy == "dirty") return CheckoutOutcome.Dirty
    if (result.accepted) hooks.track(StoreEvent.BranchActed(StoreEvent.BranchAction.Checkout))
    loadGitStatus(sessionId)
    loadSessions(repoRoot)
    if (result.accepted) CheckoutOutcome.Ok else CheckoutOutcome.Failed
  } catch (e: Exception) {
    report(e)
    CheckoutOutcome.Failed
  }
}

suspend fun HostStore.createBranch(sessionId: String, repoRoot: String, name: String, checkout: Boolean, startPoint: String? = null) {
  val backend = backend ?: return
  try {
    backend.request(Methods.SessionsCreateBranch, MethodsTypes.SessionsCreateBranchParams(sessionId, name, startPoint, checkout))
    hooks.track(StoreEvent.BranchActed(StoreEvent.BranchAction.Create))
    loadGitStatus(sessionId)
  } catch (e: Exception) {
    report(e)
  }
}

enum class DeleteBranchOutcome { Ok, Unmerged, Failed }

suspend fun HostStore.deleteBranch(sessionId: String, name: String, force: Boolean = false): DeleteBranchOutcome {
  val backend = backend ?: return DeleteBranchOutcome.Failed
  return try {
    val result = backend.request(Methods.SessionsDeleteBranch, MethodsTypes.SessionsDeleteBranchParams(sessionId, name, force))
    if (result.blockedBy == "unmerged") return DeleteBranchOutcome.Unmerged
    if (result.accepted) hooks.track(StoreEvent.BranchActed(StoreEvent.BranchAction.Delete))
    if (result.accepted) DeleteBranchOutcome.Ok else DeleteBranchOutcome.Failed
  } catch (e: Exception) {
    report(e)
    DeleteBranchOutcome.Failed
  }
}

// History

/** [ref] is the branch as git knows it: `origin/x` for a remote-only one. */
suspend fun HostStore.branchLog(sessionId: String, ref: String, count: Int = 100): List<RemoteCommit>? {
  val backend = backend ?: return null
  return try {
    backend.request(Methods.SessionsBranchLog, MethodsTypes.SessionsBranchLogParams(sessionId, ref, count.toLong())).commits
  } catch (e: Exception) {
    report(e, "branch:log")
    null
  }
}

suspend fun HostStore.commitDiff(sessionId: String, hash: String): String? {
  val backend = backend ?: return null
  return try {
    backend.request(Methods.SessionsCommitDiff, MethodsTypes.SessionsCommitDiffParams(sessionId, hash)).diff
  } catch (e: Exception) {
    report(e, "branch:commit")
    null
  }
}

suspend fun HostStore.compareBranches(sessionId: String, left: String, right: String): RemoteBranchCompare? {
  val backend = backend ?: return null
  return try {
    backend.request(Methods.SessionsCompareBranches, MethodsTypes.SessionsCompareBranchesParams(sessionId, left, right))
  } catch (e: Exception) {
    report(e, "branch:compare")
    null
  }
}

/** The code host's "open a PR" page; null when the repo has no GitHub or GitLab remote. */
suspend fun HostStore.branchPullRequestUrl(sessionId: String, branch: String): String? {
  val backend = backend ?: return null
  return runCatching { backend.request(Methods.SessionsBranchPrUrl, MethodsTypes.SessionsBranchPrUrlParams(sessionId, branch)).url }.getOrNull()
}

// Branch actions

/** Run one branch action, refresh what it changed, and report a failure (a merge stopped on conflicts included). */
private suspend fun <P, R> HostStore.branchAction(command: RemoteCommand<P, R>, params: P, sessionId: String, action: StoreEvent.BranchAction): Boolean {
  val backend = backend ?: return false
  return try {
    backend.request(command, params)
    hooks.track(StoreEvent.BranchActed(action))
    loadGitStatus(sessionId)
    true
  } catch (e: Exception) {
    report(e, "branch:${action.wire}")
    false
  }
}

suspend fun HostStore.mergeIntoCurrent(sessionId: String, from: String, squash: Boolean): Boolean =
  branchAction(Methods.SessionsMergeBranch, MethodsTypes.SessionsMergeBranchParams(sessionId, from, squash), sessionId, StoreEvent.BranchAction.Merge)

suspend fun HostStore.rebaseCurrent(sessionId: String, onto: String): Boolean =
  branchAction(Methods.SessionsRebaseCurrent, MethodsTypes.SessionsRebaseCurrentParams(sessionId, onto), sessionId, StoreEvent.BranchAction.Rebase)

suspend fun HostStore.pushBranch(sessionId: String, branch: String, remote: String?, setUpstream: Boolean, forceWithLease: Boolean): Boolean =
  branchAction(
    Methods.SessionsPushBranch,
    MethodsTypes.SessionsPushBranchParams(sessionId, branch, remote, setUpstream, forceWithLease),
    sessionId,
    StoreEvent.BranchAction.Push,
  )

enum class PullStrategy(val wire: String, val label: String) {
  FfOnly("ff-only", "Fast-forward"),
  Merge("merge", "Merge"),
  Rebase("rebase", "Rebase"),
}

suspend fun HostStore.pullCurrent(sessionId: String, strategy: PullStrategy): Boolean =
  branchAction(
    Methods.SessionsPull, MethodsTypes.SessionsPullParams(sessionId, MethodsTypes.SessionsPullParamsStrategy(strategy.wire)),
    sessionId, StoreEvent.BranchAction.Pull,
  )

suspend fun HostStore.renameLocalBranch(sessionId: String, from: String, to: String): Boolean =
  branchAction(Methods.SessionsRenameLocalBranch, MethodsTypes.SessionsRenameLocalBranchParams(sessionId, from, to), sessionId, StoreEvent.BranchAction.Rename)

suspend fun HostStore.setBranchPinned(sessionId: String, branch: String, pinned: Boolean): Boolean =
  branchAction(Methods.SessionsPinBranch, MethodsTypes.SessionsPinBranchParams(sessionId, branch, pinned), sessionId, StoreEvent.BranchAction.Pin)
