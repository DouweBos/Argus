package dev.houwert.argus.core.pullrequests

import dev.houwert.argus.kit.protocol.generated.RemotePullRequest
import dev.houwert.argus.kit.protocol.generated.RemotePullRequestCheck
import dev.houwert.argus.kit.protocol.generated.RemotePullRequestDetail

/** Green, red, still going, or neither. */
enum class CheckTone { Success, Danger, Warning, Muted }

val RemotePullRequestCheck.tone: CheckTone
  get() = when (conclusion?.lowercase()) {
    "success", "neutral", "skipped" -> CheckTone.Success
    "failure", "timed_out", "startup_failure", "action_required" -> CheckTone.Danger
    "cancelled", "stale" -> CheckTone.Muted
    else -> if (status?.lowercase() == "completed") CheckTone.Muted else CheckTone.Warning
  }

/** Nothing red, and nothing still running. */
val RemotePullRequestDetail.checksPassing: Boolean
  get() = checks.isNotEmpty() && checks.all { it.tone == CheckTone.Success || it.tone == CheckTone.Muted }

val RemotePullRequestDetail.id: String get() = "$repo#${number.toInt()}"

val RemotePullRequest.id: String get() = "$repo#${number.toInt()}"

enum class RemoteMergeStrategy(val wire: String, val label: String) {
  Squash("squash", "Squash and merge"),
  Merge("merge", "Create a merge commit"),
  Rebase("rebase", "Rebase and merge");

  companion object {
    /** The last one used, remembered by every app that merges. */
    const val PREFERENCE_KEY = "pullRequestMergeStrategy"

    fun of(raw: String?): RemoteMergeStrategy = entries.firstOrNull { it.wire == raw } ?: Squash
  }
}
