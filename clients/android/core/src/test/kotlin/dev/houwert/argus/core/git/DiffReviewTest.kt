package dev.houwert.argus.core.git

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.addReviewComment
import dev.houwert.argus.core.stores.adoptSession
import dev.houwert.argus.core.stores.loadAgents
import dev.houwert.argus.core.stores.sendReview
import dev.houwert.argus.core.support.FakeBackend
import dev.houwert.argus.core.support.attach
import dev.houwert.argus.core.support.string
import dev.houwert.argus.kit.protocol.generated.Commands
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.util.DiffLineKind
import dev.houwert.argus.kit.util.DiffParser
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.test.runTest
import org.junit.Test

class DiffReviewTest {
  private val session =
    """{"id":"s-1","kind":"worktree","branch":"feat","display_name":"Feat","description":"","path":"/work/argus-feat","repo_root":"/work/argus","status":"ready"}"""

  private fun comment(path: String, lines: IntRange, body: String, side: DiffReviewComment.Side = DiffReviewComment.Side.New) =
    DiffReviewComment(
      path = path, side = side, lines = lines, excerpt = listOf("let x = 1"), hunk = "@@ -1,2 +1,2 @@\n-let x = 0\n+let x = 1",
      scope = "uncommitted changes", body = body,
    )

  @Test fun threeCommentsOnTwoFilesBecomeOneMessageEachWithItsLocationAndHunk() {
    val comments = listOf(
      comment("b.ts", 4..4, "Rename this."),
      comment("a.ts", 12..14, "Handle nil."),
      comment("a.ts", 3..3, "Why removed?", DiffReviewComment.Side.Old),
    )
    val message = DiffReviewPrompt.message(comments)
    assertTrue("## 1. a.ts:3 (removed)" in message)
    assertTrue("## 2. a.ts:12-14" in message)
    assertTrue("## 3. b.ts:4" in message)
    assertEquals(4, message.split("```diff\n@@ -1,2 +1,2 @@").size)
    assertTrue("Handle nil." in message)
    val display = DiffReviewPrompt.displayText(comments)
    assertTrue(display.startsWith("Review: 3 comments on 2 files"))
    assertFalse("@@" in display)
  }

  @Test fun aHunkWithAFenceInItGetsALongerFence() {
    val c = comment("README.md", 1..1, "Fix the example.").copy(hunk = "@@ -1 +1 @@\n+```swift")
    assertTrue("````diff\n" in DiffReviewPrompt.message(listOf(c)))
  }

  @Test fun aCommentAnchorsToItsLastLineBySideNumberAndText() {
    val c = comment("a.ts", 12..14, "x")
    assertTrue(c.anchors("a.ts", DiffReviewComment.Side.New, 14, "let x = 1"))
    assertFalse(c.anchors("a.ts", DiffReviewComment.Side.New, 14, "let x = 2"))
    assertFalse(c.anchors("a.ts", DiffReviewComment.Side.Old, 14, "let x = 1"))
  }

  @Test fun aTappedRemovedLineCommentsOnTheOldSideAndFindsItselfAgain() {
    val diff = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n-let x = 0\n+let x = 1\n same\n"
    val hunk = DiffParser.parse(diff).first().hunks.first()
    val removed = hunk.lines.first { it.kind == DiffLineKind.REMOVE }
    val c = assertNotNull(DiffReviewComment.draft("a.ts", hunk, removed, "uncommitted changes"))
    assertEquals(DiffReviewComment.Side.Old, c.side)
    assertEquals(1..1, c.lines)
    assertTrue(c.hunk.startsWith("@@ -1,2 +1,2 @@\n-let x = 0\n+let x = 1"))
    assertTrue(c.anchors("a.ts", removed))
    assertFalse(c.anchors("a.ts", hunk.lines.first { it.kind == DiffLineKind.ADD }))
  }

  @Test fun sendingPostsOneMessageToTheLiveAgentAndClearsTheDrafts() = runTest {
    val store = HostStore(backgroundScope)
    val backend = FakeBackend()
    backend.reply(Commands.GetSession, session)
    backend.reply(Methods.AgentsSend, """{"queued":true}""")
    backend.reply(Methods.AgentsList, """{"agents":[{"agent_id":"a-1","session_id":"s-1","status":"idle","created_at":1}]}""")
    attach(store, backend)
    store.adoptSession("s-1")
    store.loadAgents("/work/argus")
    store.addReviewComment(comment("a.ts", 1..1, "One"), "s-1")
    store.addReviewComment(comment("b.ts", 2..2, "Two"), "s-1")

    val agentId = store.sendReview("s-1")

    assertEquals("a-1", agentId)
    val params = assertNotNull(backend.params(Methods.AgentsSend))
    assertEquals("a-1", params.string("agent_id"))
    assertTrue(params.string("message")!!.contains("## 2. b.ts:2"))
    assertTrue(params.string("display_text")!!.startsWith("Review: 2 comments on 2 files"))
    assertTrue(store.reviews.comments("s-1").isEmpty())
  }
}
