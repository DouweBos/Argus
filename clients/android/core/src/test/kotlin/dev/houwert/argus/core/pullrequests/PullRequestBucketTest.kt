package dev.houwert.argus.core.pullrequests

import dev.houwert.argus.core.support.decode
import dev.houwert.argus.kit.protocol.generated.RemotePullRequest
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.junit.Test

class PullRequestBucketTest {
  private fun pr(number: Int, reasons: List<String>, review: String? = null, draft: Boolean = false, updated: String = "2026-01-01T00:00:00Z"): RemotePullRequest {
    val reasonsJson = reasons.joinToString(",") { "\"$it\"" }
    val reviewJson = review?.let { ""","review_decision":"$it"""" } ?: ""
    return decode(
      RemotePullRequest.serializer(),
      """{"number":$number,"title":"PR $number","repo":"o/r","repo_root":"/r","is_draft":$draft,"head_ref":"h","base_ref":"main","url":"https://x","updated_at":"$updated","reasons":[$reasonsJson]$reviewJson}""",
    )
  }

  @Test fun aReviewRequestWaitsOnMeUntilApprovedDraftsBeatReviewStates() {
    assertEquals(PullRequestBucket.AwaitingMe, PullRequestBucket.of(pr(1, listOf("reviewer"))))
    assertEquals(PullRequestBucket.AwaitingMe, PullRequestBucket.of(pr(1, listOf("team"), draft = true)))
    assertEquals(PullRequestBucket.Approved, PullRequestBucket.of(pr(1, listOf("reviewer"), "APPROVED")))
    assertEquals(PullRequestBucket.Draft, PullRequestBucket.of(pr(1, listOf("author"), "CHANGES_REQUESTED", draft = true)))
    assertEquals(PullRequestBucket.ChangesRequested, PullRequestBucket.of(pr(1, listOf("author"), "CHANGES_REQUESTED")))
    assertEquals(PullRequestBucket.AwaitingOthers, PullRequestBucket.of(pr(1, listOf("author"))))
    assertEquals(PullRequestBucket.Other, PullRequestBucket.of(pr(1, listOf("mentioned"))))
  }

  @Test fun bucketsInDisplayOrderDirectRequestsBeforeTeamOnesThenNewestFirst() {
    val groups = PullRequestBucket.group(
      listOf(
        pr(1, listOf("author")),
        pr(2, listOf("team"), updated = "2026-03-01T00:00:00Z"),
        pr(3, listOf("reviewer"), updated = "2026-01-01T00:00:00Z"),
        pr(4, listOf("reviewer"), updated = "2026-02-01T00:00:00Z"),
      )
    )
    assertEquals(listOf(PullRequestBucket.AwaitingMe, PullRequestBucket.AwaitingOthers), groups.map { it.bucket })
    assertEquals(listOf(4, 3, 2), groups[0].prs.map { it.number.toInt() })
    assertTrue(groups.any { it.bucket.needsAttention })
  }
}
