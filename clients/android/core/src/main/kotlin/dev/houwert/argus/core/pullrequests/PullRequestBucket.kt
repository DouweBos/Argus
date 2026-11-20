package dev.houwert.argus.core.pullrequests

import dev.houwert.argus.kit.protocol.generated.RemotePullRequest

/** Where a PR sits in the list: what needs you first, the quiet ones after. */
enum class PullRequestBucket(val title: String) {
  AwaitingMe("Awaiting my review"),
  ChangesRequested("Changes requested"),
  AwaitingOthers("Awaiting another review"),
  Approved("Approved"),
  Draft("Draft"),
  Other("Other");

  val needsAttention: Boolean get() = this == AwaitingMe || this == ChangesRequested || this == Approved

  data class Group(val bucket: PullRequestBucket, val prs: List<RemotePullRequest>)

  companion object {
    fun of(pr: RemotePullRequest): PullRequestBucket {
      val reviewer = "reviewer" in pr.reasons || "team" in pr.reasons
      return when {
        reviewer && pr.reviewDecision != "APPROVED" -> AwaitingMe
        pr.isDraft -> Draft
        pr.reviewDecision == "CHANGES_REQUESTED" -> ChangesRequested
        pr.reviewDecision == "APPROVED" -> Approved
        "author" in pr.reasons -> AwaitingOthers
        else -> Other
      }
    }

    /** Buckets in display order, each newest first; direct review requests ahead of team ones. */
    fun group(prs: List<RemotePullRequest>): List<Group> {
      val grouped = prs.groupBy(::of)
      return entries.mapNotNull { bucket ->
        val list = grouped[bucket]?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
        val sorted = list.sortedWith { a, b ->
          val ra = "reviewer" in a.reasons
          val rb = "reviewer" in b.reasons
          if (bucket == AwaitingMe && ra != rb) (if (ra) -1 else 1) else b.updatedAt.compareTo(a.updatedAt)
        }
        Group(bucket, sorted)
      }
    }
  }
}
