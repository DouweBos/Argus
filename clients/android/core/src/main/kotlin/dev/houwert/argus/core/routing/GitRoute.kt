package dev.houwert.argus.core.routing

/**
 * A session's git sub-view: `/sessions/:sessionId/git/:gitView`, as in `docs/routing.md`.
 * Ref routes (`branches/:name`, `tags/:name`) show the history filtered to that ref.
 */
sealed interface GitRoute {
  data object Working : GitRoute
  /** The session branch's own commits against its base. */
  data object Branch : GitRoute
  data object History : GitRoute
  data object Stashes : GitRoute
  data object Reflog : GitRoute
  data object Conflicts : GitRoute
  /** History filtered to a branch; null is the bare `/git/branches`, all branches. */
  data class Branches(val name: String? = null) : GitRoute
  data class Tags(val name: String) : GitRoute
  data object Submodules : GitRoute
  data object Bisect : GitRoute
  data object Hooks : GitRoute
  data class Compare(val left: String, val right: String) : GitRoute
  data class Blame(val path: String? = null, val ref: String? = null) : GitRoute
  data object Settings : GitRoute
  data object PullRequests : GitRoute
  data object BranchesReview : GitRoute
  data class InteractiveRebase(val from: String) : GitRoute
  /** The review guide: an agent-written tour of the branch's changes. */
  data object Guide : GitRoute
  /** The session's agent turns, newest first, with one turn's diff open; null is the newest. */
  data class Timeline(val turn: String? = null) : GitRoute

  /** The `:gitView` segment, never a ref name or a path: what telemetry may see. */
  val segment: String
    get() = when (this) {
      Working -> "working"
      Branch -> "branch"
      History -> "history"
      Stashes -> "stashes"
      Reflog -> "reflog"
      Conflicts -> "conflicts"
      is Branches -> if (name == null) "branches" else "branches/:branchName"
      is Tags -> "tags/:tagName"
      Submodules -> "submodules"
      Bisect -> "bisect"
      Hooks -> "hooks"
      is Compare -> "compare"
      is Blame -> "blame"
      Settings -> "settings"
      PullRequests -> "pull-requests"
      BranchesReview -> "branches-review"
      is InteractiveRebase -> "interactive-rebase"
      Guide -> "guide"
      is Timeline -> "timeline"
    }

  /** The ref a history route is filtered to, if any. */
  val historyRef: String?
    get() = when (this) {
      is Branches -> name
      is Tags -> name
      else -> null
    }

  /** Ref routes render the history view. */
  val showsHistory: Boolean get() = this == History || this is Branches || this is Tags

  /** Views that only make sense on the project-root session. */
  val isProjectScope: Boolean
    get() = when (this) {
      History, is Branches, is Tags, Submodules, Bisect, Hooks, Settings, PullRequests, BranchesReview -> true
      else -> false
    }

  /** What follows `/git/` in a path, query included. */
  val pathSuffix: String get() = gitPathSuffix(this)

  companion object {
    /**
     * `/git/<segments>?<query>`: decoded segments after `git` and the query items. Bare `/git` is
     * the working copy; a ref may arrive as one encoded segment or spread over several.
     */
    fun parse(segments: List<String>, query: Map<String, String>): GitRoute? = parseGitRoute(segments, query)
  }
}
