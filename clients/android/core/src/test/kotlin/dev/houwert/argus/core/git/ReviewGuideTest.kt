package dev.houwert.argus.core.git

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.kit.protocol.ProtocolJson
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.RemotePullRequestReviewCommentSide
import dev.houwert.argus.kit.protocol.generated.RemoteReviewGuideStateStatus
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.Test

class ReviewGuideTest {
  private val session = ReviewGuideTarget.Session("s-1")

  private val patch = listOf(
    "diff --git a/src/session/merge.ts b/src/session/merge.ts",
    "--- a/src/session/merge.ts",
    "+++ b/src/session/merge.ts",
    "@@ -1,3 +1,4 @@",
    " import { git } from './git'",
    "+import { strategy } from './strategy'",
    " ",
    " export const x = 1",
    "@@ -8,11 +9,14 @@ export async function merge() {",
    " const a = 1",
    "-const base = await mergeBase()",
    "+const how = strategy()",
    "+await git.merge(how)",
    " return a",
    "diff --git a/README.md b/README.md",
    "--- a/README.md",
    "+++ b/README.md",
    "@@ -1 +1,2 @@",
    " # Luma",
    "+Run `pnpm dev`.",
    "",
  ).joinToString("\n")

  private fun stop(id: String, path: String, ranges: String) =
    """{"id":"$id","title":"Stop $id","summary":"","mechanical":false,"look_closely":[],"paths":["$path"],"ranges":$ranges}"""

  private fun ready(): String {
    val stops = listOf(
      stop("s1", "src/session/merge.ts", """[{"path":"src/session/merge.ts","side":"new","start":10,"end":12}]"""),
      stop("s2", "README.md", "[]"),
      stop("s3", "src/session/merge.ts", "[]"),
    ).joinToString(",")
    val guide = """{"head_sha":"f00","base_ref":"main","overview":"","stops":[$stops],"generated_at":"2026-01-01T00:00:00Z"}"""
    val state = buildJsonObject {
      put("status", JsonPrimitive("ready"))
      put("guide", ProtocolJson.json.parseToJsonElement(guide))
      put("stale", JsonPrimitive(false))
      put("patch", JsonPrimitive(patch))
    }
    return """{"guide":$state}"""
  }

  private suspend fun TestScope.store(reply: String): HostStore {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(Methods.ReviewGuidesGet, reply)
    attach(store, backend)
    store.loadReviewGuide(session)
    return store
  }

  @Test fun aReadyGuideDecodesAndAStopsFilesKeepOnlyTheHunksItPointsAt() = runTest {
    val store = store(ready())
    val guide = assertNotNull(store.reviewGuides.state(session)?.guide)
    assertEquals(listOf("s1", "s2", "s3"), guide.stops.map { it.id })
    val files = store.reviewGuides.files(session, guide.stops[0])
    assertEquals(listOf("src/session/merge.ts"), files.map { it.displayPath })
    assertEquals(1, files.first().hunks.size)
    assertTrue(files.first().hunks.first().header.startsWith("@@ -8,11 +9,14 @@"))
    // A stop with no ranges shows its files whole.
    assertEquals(2, store.reviewGuides.files(session, guide.stops[2]).first().hunks.size)
  }

  @Test fun readingEveryStopCompletesTheGuideOnce() = runTest {
    val store = store(ready())
    for (stop in listOf("s1", "s2", "s1", "s3")) store.markStopVisited(session, stop)
    assertEquals(setOf("s1", "s2", "s3"), store.reviewGuides.visited(session))
  }

  @Test fun aFailedGuideCarriesTheHostsReason() = runTest {
    val store = store("""{"guide":{"status":"failed","stale":false,"error":"Check that claude is signed in"}}""")
    assertEquals(RemoteReviewGuideStateStatus.failed, store.reviewGuides.state(session)?.status)
    assertTrue(store.reviewGuides.state(session)?.error!!.contains("signed in"))
  }

  @Test fun aPullRequestsDraftsAreKeptApartFromAnySessions() {
    assertEquals("abc", ReviewGuideTarget.Session("abc").key)
    assertEquals("pr:acme/luma#482", ReviewGuideTarget.PullRequest("acme/luma", 482, "f00").key)
  }

  @Test fun draftsBecomeInlineCommentsRemovedLinesOnTheLeftARangeWithAStartLine() {
    val removed = DiffReviewComment(path = "a.ts", side = DiffReviewComment.Side.Old, lines = 3..3, excerpt = listOf("x"), hunk = "", scope = "pull request #1", body = "Why?")
    val range = DiffReviewComment(path = "a.ts", side = DiffReviewComment.Side.New, lines = 10..12, excerpt = listOf("y"), hunk = "", scope = "pull request #1", body = "Split.")
    val left = PullRequestReviewComments.wire(removed)
    val right = PullRequestReviewComments.wire(range)
    assertEquals(RemotePullRequestReviewCommentSide.lEFT, left.side)
    assertEquals(3L, left.line)
    assertNull(left.startLine)
    assertEquals(RemotePullRequestReviewCommentSide.rIGHT, right.side)
    assertEquals(12L, right.line)
    assertEquals(10L, right.startLine)
  }
}
