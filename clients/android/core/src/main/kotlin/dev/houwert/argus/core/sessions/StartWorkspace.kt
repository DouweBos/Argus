package dev.houwert.argus.core.sessions

import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionKind

// The pure parts of `StartWorkspace.swift`; its observable state and base-branch loading belong to the store port.

/**
 * Where a start composer's first message goes: the checkout in front of you, a new worktree off a
 * base branch, or a branch that already exists.
 */
object StartWorkspace {
  enum class Kind(val rawValue: String) { Current("current"), Worktree("worktree"), Existing("existing") }

  const val WORKTREE_LABEL = "New worktree"
  const val WORKTREE_HINT = "A new branch, named from the prompt"
  const val EXISTING_LABEL = "Existing branch"

  /** "Current checkout" on a project's root, "This worktree" on a worktree, "This session" elsewhere. */
  fun currentLabel(kind: RemoteSessionKind?): String = when (kind) {
    RemoteSessionKind.projectRoot -> "Current checkout"
    RemoteSessionKind.worktree -> "This worktree"
    else -> "This session"
  }

  /** What the base menu reads while it has no branch to name. */
  fun baseTitle(base: String?, loading: Boolean): String = when {
    base != null -> "from $base"
    loading -> "Loading branches"
    else -> "Project default"
  }

  /** The project root's branch, which a new worktree's base preselects from. */
  fun projectRootBranch(sessions: List<RemoteSession>?): String? =
    sessions?.firstOrNull { it.kind == RemoteSessionKind.projectRoot }?.branch
}
