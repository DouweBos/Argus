package dev.houwert.argus.core.git

import dev.houwert.argus.kit.net.TransportException
import dev.houwert.argus.kit.protocol.generated.GitRunnerFailure
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/**
 * A failed git command, typed the way the desktop's error banner is: what kind of failure
 * it was and which fix git's output points at. Built from the host's `GitError` payload, a
 * gateway runner's `failure`, or by classifying git's text like the host does.
 */
data class GitFailure(val kind: Kind, val message: String, val recovery: String? = null, val details: String? = null) {
  enum class Kind(val raw: String) {
    AuthRequired("auth-required"), BranchCheckedOut("branch-checked-out"), Busy("busy"),
    CherryPickConflict("cherry-pick-conflict"), DetachedHead("detached-head"), DirtyWorkingTree("dirty-working-tree"),
    HookFailed("hook-failed"), LfsMissing("lfs-missing"), LockFileExists("lock-file-exists"), MergeConflict("merge-conflict"),
    NetworkTimeout("network-timeout"), NoUpstream("no-upstream"), NonFastForward("non-fast-forward"),
    NothingToCommit("nothing-to-commit"), NothingToPull("nothing-to-pull"), NothingToPush("nothing-to-push"),
    OutputTooLarge("output-too-large"), RebaseConflict("rebase-conflict"), SigningFailed("signing-failed"), Unknown("unknown");

    companion object {
      fun of(raw: String) = entries.firstOrNull { it.raw == raw } ?: Unknown
    }
  }

  /** A fix the banner offers, as the desktop's `GitErrorBanner` names them. */
  enum class Action(val raw: String, val label: String) {
    PublishBranch("publish-branch", "Publish Branch"),
    PullThenPush("pull-then-push", "Pull Then Push"),
    ForceWithLease("force-with-lease", "Force Push (with Lease)"),
    Retry("retry", "Retry"),
    OpenConflicts("open-conflicts", "Open Conflicts"),
    ContinueOperation("continue", "Continue"),
    AbortOperation("abort", "Abort"),
    StashAndRetry("stash-and-retry", "Stash and Retry"),
    InstallLfs("install-lfs", "Install Git LFS"),
    ConfigureSigning("configure-signing", "Configure Signing"),
    CopyDetails("copy-details", "Copy Details");

    val isDestructive: Boolean get() = this == ForceWithLease || this == AbortOperation
  }

  /** The fixes worth offering, primary first. [canRetry] is false when there's nothing to repeat. */
  fun actions(canRetry: Boolean): List<Action> {
    val all = when (kind) {
      Kind.NoUpstream -> listOf(Action.PublishBranch)
      Kind.NonFastForward -> listOf(Action.PullThenPush, Action.ForceWithLease)
      Kind.AuthRequired, Kind.NetworkTimeout, Kind.LockFileExists -> listOf(Action.Retry, Action.CopyDetails)
      Kind.MergeConflict, Kind.CherryPickConflict -> listOf(Action.OpenConflicts, Action.AbortOperation)
      Kind.RebaseConflict -> listOf(Action.OpenConflicts, Action.ContinueOperation, Action.AbortOperation)
      Kind.DirtyWorkingTree -> listOf(Action.StashAndRetry)
      Kind.LfsMissing -> listOf(Action.InstallLfs, Action.CopyDetails)
      Kind.SigningFailed -> listOf(Action.ConfigureSigning, Action.CopyDetails)
      Kind.HookFailed -> listOf(Action.Retry, Action.CopyDetails)
      Kind.Unknown, Kind.DetachedHead, Kind.BranchCheckedOut -> listOf(Action.CopyDetails)
      Kind.Busy, Kind.OutputTooLarge, Kind.NothingToCommit, Kind.NothingToPull, Kind.NothingToPush -> emptyList()
    }
    val retrying = setOf(Action.Retry, Action.StashAndRetry, Action.PullThenPush, Action.ForceWithLease)
    return all.filter { canRetry || it !in retrying }
  }

  companion object {
    /** The host's serialised `GitError`, carried in a wire error's `data`. */
    fun from(error: Throwable): GitFailure? {
      val payload = (error as? TransportException.Gateway)?.payload ?: return null
      val data = payload.data as? JsonObject ?: return null
      fun string(key: String) = (data[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
      if ((data["__gitError"] as? JsonPrimitive)?.booleanOrNull != true) return null
      val kind = string("kind") ?: return null
      return GitFailure(Kind.of(kind), string("message") ?: payload.message, string("recovery"), string("stderr"))
    }

    /** A gateway git runner's typed `failure`. */
    fun from(failure: GitRunnerFailure, stderr: String?) =
      GitFailure(Kind.of(failure.kind.rawValue), failure.message, failure.recovery?.rawValue, stderr)

    /** Git's own text sorted into a kind, as the host's `classifyGitStderr` does. [operation] tells a rebase from a merge. */
    fun classify(text: String, operation: String? = null): GitFailure {
      fun has(vararg patterns: String) = patterns.any { Regex(it, setOf(RegexOption.IGNORE_CASE, RegexOption.MULTILINE)).containsMatchIn(text) }
      val trimmed = text.trim()
      fun failure(kind: Kind, fallback: String, recovery: String? = null) =
        GitFailure(kind, trimmed.ifEmpty { fallback }, recovery, text)
      if (has("is already (used by|checked out at) worktree")) return failure(Kind.BranchCheckedOut, "Branch is already checked out in another worktree")
      if (has("""index\.lock""", """unable to create '.*\.lock'""", "another git process is using this repository")) {
        return failure(Kind.LockFileExists, "Another git process is holding the index lock")
      }
      if (has("no upstream branch", "there is no tracking information", "the current branch .* has no upstream")) {
        return failure(Kind.NoUpstream, "Branch has no upstream configured", "publish-branch")
      }
      if (has(
          "updates were rejected because the tip", "non-fast-forward", "failed to push some refs", """\(fetch first\)""",
          "the remote has commits you don't have yet", "someone pushed to the remote branch since your last fetch",
        )
      ) {
        return failure(Kind.NonFastForward, "Push rejected: remote has changes you don't have locally", "pull-then-push")
      }
      if (has(
          "authentication failed", "could not read username", """permission denied \(publickey\)""", "could not read password",
          "403 forbidden", "didn't accept your credentials",
        )
      ) {
        return failure(Kind.AuthRequired, "Authentication required", "reauthenticate")
      }
      if (has(
          "could not resolve host", "unable to access", "operation timed out", "connection timed out", "network is unreachable",
          "couldn't reach the remote",
        )
      ) {
        return failure(Kind.NetworkTimeout, "Network error contacting remote", "retry")
      }
      if (has(
          """^CONFLICT \(""", "merge conflict in", "after resolving the conflicts", "fix conflicts and then commit",
          "resolve all conflicts manually", "there are conflicts to resolve",
        )
      ) {
        val op = operation?.lowercase().orEmpty()
        if ("rebase" in op) return failure(Kind.RebaseConflict, "Rebase paused on conflict", "resolve-conflicts")
        if ("cherry" in op || has("cherry-pick")) return failure(Kind.CherryPickConflict, "Cherry-pick paused on conflict", "resolve-conflicts")
        return failure(Kind.MergeConflict, "Merge paused on conflict", "resolve-conflicts")
      }
      if (has(
          "your local changes .* would be overwritten", "please commit your changes or stash them", "you have unstaged changes",
          "uncommitted changes would be overwritten",
        )
      ) {
        return failure(Kind.DirtyWorkingTree, "Working tree has uncommitted changes", "stash-and-retry")
      }
      if (has("head is now at") && has("detached")) return failure(Kind.DetachedHead, "HEAD is detached")
      if (has("nothing to commit", "no changes added to commit", "nothing added to commit")) return failure(Kind.NothingToCommit, "Nothing to commit")
      if (has("everything up-to-date")) return failure(Kind.NothingToPush, "Everything up to date")
      if (has("already up to date")) return failure(Kind.NothingToPull, "Already up to date")
      if (has("gpg failed to sign", "failed to sign the data", "secret key not available", "no signing key", "signing failed")) {
        return failure(Kind.SigningFailed, "Commit signing failed", "configure-signing")
      }
      if (has("git-lfs") && has("not installed", "not found", "smudge", "isn't installed")) {
        return failure(Kind.LfsMissing, "git-lfs is not available", "install-lfs")
      }
      if (has("hook .* failed", "pre-commit hook", "pre-push hook", """\.git/hooks/""")) {
        return failure(Kind.HookFailed, "A git hook failed", "show-hook-output")
      }
      return failure(Kind.Unknown, "git command failed")
    }
  }
}
