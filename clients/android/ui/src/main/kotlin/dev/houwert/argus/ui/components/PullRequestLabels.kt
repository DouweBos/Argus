package dev.houwert.argus.ui.components

import dev.houwert.argus.kit.protocol.generated.SessionPullRequest
import dev.houwert.argus.kit.protocol.generated.SessionPullRequestState
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.ui.theme.Tone
import java.net.URI
import java.time.Instant

/** How a PR's reasons, review state and dates read, on every screen alike. */
object PullRequestLabels {
  /** Whether a pull request URL is a GitLab merge request. */
  fun isGitLab(url: String?): Boolean {
    if (url == null) return false
    return "/-/merge_requests/" in url || runCatching { URI(url).host?.contains("gitlab") == true }.getOrDefault(false)
  }

  /** "GitHub" or "GitLab", for "Open on …". */
  fun host(url: String?): String = if (isGitLab(url)) "GitLab" else "GitHub"

  fun openOn(url: String?): String = "Open on ${host(url)}"

  /** `#123` on GitHub, `!123` on GitLab. */
  fun ref(number: Int, url: String?): String = if (isGitLab(url)) "!$number" else "#$number"

  /** "Pull request #123 · Merged", or "Merge request !123" on GitLab. */
  fun state(pr: SessionPullRequest): String {
    val state = when (pr.state) {
      SessionPullRequestState.open -> "Open"
      SessionPullRequestState.draft -> "Draft"
      SessionPullRequestState.merged -> "Merged"
      else -> "Closed"
    }
    val noun = if (isGitLab(pr.url)) "Merge request" else "Pull request"
    return "$noun ${ref(pr.number.toInt(), pr.url)} · $state"
  }

  /** The state, plus that an agent is watching it. */
  fun state(pr: SessionPullRequest, watching: Boolean): String = if (watching) "${state(pr)} · Watched" else state(pr)

  fun reason(raw: String): String = when (raw) {
    "author" -> "Author"
    "reviewer" -> "Reviewer"
    "team" -> "Team review"
    "commenter" -> "Commented"
    "mentioned" -> "Mentioned"
    else -> raw.replaceFirstChar { it.uppercase() }
  }

  fun reasonTone(raw: String): Tone = when (raw) {
    "author" -> Tone.Accent
    "reviewer", "team" -> Tone.Success
    else -> Tone.Muted
  }

  fun review(decision: String): Pair<String, Tone>? = when (decision) {
    "APPROVED" -> "Approved" to Tone.Success
    "CHANGES_REQUESTED" -> "Changes requested" to Tone.Danger
    "REVIEW_REQUIRED" -> "Review required" to Tone.Warning
    else -> null
  }

  /** An ISO date as "3h ago"; the raw string if it doesn't parse. */
  fun relative(iso: String): String =
    runCatching { Labels.timeAgo(Instant.parse(iso).toEpochMilli().toDouble()) }.getOrDefault(iso)

  /** `gh` or `glab` missing or signed out is the usual failure; say how to fix it. */
  fun explain(error: String): String {
    val lower = error.lowercase()
    if ("glab" in lower || "gitlab" in lower) {
      if ("not installed" in lower || "enoent" in lower) {
        return "The GitLab CLI (glab) is required. Install it and run `glab auth login`, then try again."
      }
      if ("signed in" in lower || "auth login" in lower) return "The GitLab CLI isn't signed in. Run `glab auth login`, then try again."
    }
    if ("enoent" in lower || ("not found" in lower && "gh" in lower)) {
      return "The GitHub CLI (gh) is required. Install it and run `gh auth login`, then try again."
    }
    if ("auth login" in lower || "not logged" in lower || "authenticat" in lower) {
      return "The GitHub CLI isn't signed in. Run `gh auth login`, then try again."
    }
    return error
  }
}
