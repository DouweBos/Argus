package dev.houwert.argus.core.sessions

import dev.houwert.argus.kit.protocol.generated.RemoteGitStatus
import dev.houwert.argus.kit.protocol.generated.RemoteSessionStatus
import dev.houwert.argus.kit.protocol.generated.SessionPullRequest

/** One labelled fact about a session; the session details list them in this order on every client. */
data class SessionFact(val label: String, val value: Value, val emphasis: Emphasis = Emphasis.None) {
  sealed interface Value {
    data class Text(val text: String) : Value
    /** A branch or ref, set in monospace. */
    data class Ref(val ref: String) : Value
    data class Changes(val additions: Int, val deletions: Int) : Value
    /** Epoch milliseconds; the view phrases it as an age. */
    data class Age(val millis: Double) : Value
    /** Its number and state, opening it on the forge. */
    data class PullRequest(val pullRequest: SessionPullRequest) : Value
  }

  enum class Emphasis { None, Warning, Danger }

  val id: String get() = label
}

/** Base, pull request, changes, upstream, conflicts, agents, activity and drive: whatever applies. */
fun SessionActivity.facts(git: RemoteGitStatus?): List<SessionFact> = buildList {
  val branch = git?.branch ?: session.branch
  session.baseBranch?.takeIf { it != branch }?.let { add(SessionFact("Base", SessionFact.Value.Ref(it))) }
  session.pullRequest?.let { add(SessionFact("Pull request", SessionFact.Value.PullRequest(it))) }
  if (git != null) {
    val additions = git.diffAdditions?.toInt() ?: 0
    val deletions = git.diffDeletions?.toInt() ?: 0
    val changes =
      if (additions != 0 || deletions != 0) SessionFact.Value.Changes(additions, deletions) else SessionFact.Value.Text("None")
    add(SessionFact("Changes", changes))
    if (git.dirtyCount > 0) add(SessionFact("Uncommitted", SessionFact.Value.Text(files(git.dirtyCount))))
    add(
      SessionFact(
        "Upstream",
        SessionFact.Value.Text(GitUpstreamText.describe(git)),
        if (git.behind > 0) SessionFact.Emphasis.Warning else SessionFact.Emphasis.None,
      ),
    )
    if (git.conflictCount > 0) {
      add(SessionFact("Conflicts", SessionFact.Value.Text(files(git.conflictCount)), SessionFact.Emphasis.Danger))
    }
    git.inProgress?.let { progress ->
      val kind = capitalizeWords(progress.kind.rawValue)
      val text = progress.onto?.let { "$kind onto $it" } ?: kind
      add(SessionFact("In progress", SessionFact.Value.Text(text), SessionFact.Emphasis.Warning))
    }
    if (git.stashCount > 0) add(SessionFact("Stashes", SessionFact.Value.Text("${git.stashCount.toInt()}")))
  }
  statusText?.let {
    val emphasis = if (session.status == RemoteSessionStatus.error) SessionFact.Emphasis.Danger else SessionFact.Emphasis.None
    add(SessionFact("Agents", SessionFact.Value.Text(it), emphasis))
  }
  lastActive?.let { add(SessionFact("Active", SessionFact.Value.Age(it))) }
  session.volume?.let { add(SessionFact("Drive", SessionFact.Value.Text(it))) }
}

private fun files(count: Double): String {
  val n = count.toInt()
  return "$n file${if (n == 1) "" else "s"}"
}

/** Foundation's `capitalized`: each whitespace-separated word's first letter up, the rest down. */
private fun capitalizeWords(text: String): String =
  text.split(' ').joinToString(" ") { word -> word.lowercase().replaceFirstChar { it.uppercase() } }
