package dev.houwert.argus.ui.transcript

import dev.houwert.argus.core.transcript.FileLinks
import dev.houwert.argus.core.transcript.WorkLog
import dev.houwert.argus.kit.protocol.ProtocolJson
import dev.houwert.argus.kit.protocol.generated.RemoteBackgroundTask
import dev.houwert.argus.kit.protocol.generated.RemoteBackgroundTaskStatus
import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteMessageRole
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BackgroundTaskTextTest {
  @Test
  fun aRunningTaskReadsItsElapsedTimeLive() {
    val task = RemoteBackgroundTask(RemoteBackgroundTaskStatus.running, startedAt = 1_000_000.0)
    assertEquals("Running · 4m 12s", BackgroundTaskText.label(task, nowMillis = (1_000 + 252) * 1000.0))
  }

  @Test
  fun aSettledTaskReadsHowLongItTook() {
    val now = System.currentTimeMillis().toDouble()
    assertEquals("Done in 18m 41s", BackgroundTaskText.label(RemoteBackgroundTask(RemoteBackgroundTaskStatus.completed, 0.0, 1_121_000.0), now))
    assertEquals("Failed after 3s", BackgroundTaskText.label(RemoteBackgroundTask(RemoteBackgroundTaskStatus.failed, 0.0, 3_000.0), now))
    assertEquals("Stopped after 1m 0s", BackgroundTaskText.label(RemoteBackgroundTask(RemoteBackgroundTaskStatus.stopped, 0.0, 60_000.0), now))
  }
}

class ImageViewerTest {
  @Test
  fun parsesADataUrisBytesAndMediaType() {
    val parsed = ImageViewerItem.parse("data:image/jpeg;base64,AQID")!!
    assertArrayEquals(byteArrayOf(1, 2, 3), parsed.first)
    assertEquals("image/jpeg", parsed.second)
    assertNull(ImageViewerItem.parse("AQID"))
    assertEquals("image/png", ImageViewerItem.parse(",AQID")?.second)
    assertEquals("image/png", ImageViewerItem.parse("data:;base64,AQID")?.second)
  }

  @Test
  fun namesTheFileAfterTheIdAndType() {
    assertEquals("argus-a-b-c.jpg", ImageViewerItem("a:b/c", "data:image/jpeg;base64,AQID").fileName)
    assertEquals("argus-x.png", ImageViewerItem("x", null).fileName)
  }

  @Test
  fun fitsWithinTheRoomWithoutUpscaling() {
    val room = ImageViewerItem.Size(400, 400)
    assertEquals(ImageViewerItem.Size(400, 100), ImageViewerItem.fit(800, 200, room))
    assertEquals(ImageViewerItem.Size(100, 50), ImageViewerItem.fit(100, 50, room))
    assertEquals(ImageViewerItem.Size(240, 160), ImageViewerItem.fit(0, 0, room))
  }

  @Test
  fun pagesThroughTheMessagesImagesWrappingAtBothEnds() {
    val viewer = ImageViewerState()
    viewer.present("a", listOf("1", "2", "3"), 0)
    assertEquals("1 of 3", viewer.positionLabel)
    assertTrue(viewer.previous())
    assertEquals("3", viewer.current)
    assertTrue(viewer.next())
    assertTrue(viewer.next())
    assertEquals("2 of 3", viewer.positionLabel)
    viewer.present("a", listOf("only"), 0)
    assertNull(viewer.positionLabel)
    assertFalse(viewer.next())
    assertEquals("only", viewer.current)
  }
}

class LinkifyTest {
  private fun links(text: String, files: Boolean, mentions: Boolean = false) =
    InlineMarkdown.linkified(InlineMarkdown.parse(text), files, mentions).links

  @Test
  fun bareUrlsLinkEvenWhereFilesDont() {
    assertEquals(listOf("https://x.dev/a"), links("see https://x.dev/a and src/a.ts:3:2", files = false))
    val linked = links("see https://x.dev/a and src/a.ts:3:2", files = true)
    assertEquals(2, linked.size)
    assertEquals(FileLinks.FileRef("src/a.ts", 3, 2), FileLinks.fileRef(linked[1]))
  }

  @Test
  fun typedTextLinksMentionsNotBarePaths() {
    val linked = links("look at @docs/plan and src/a.ts", files = true, mentions = true)
    assertEquals(listOf("docs/plan"), linked.map { FileLinks.fileRef(it)?.path })
  }

  @Test
  fun markdownsOwnLinksStay() {
    assertEquals(listOf("https://x.dev", "https://y.dev"), links("[a.ts](https://x.dev) then https://y.dev", files = true))
  }
}

class InlineMarkdownTest {
  private fun styles(source: String) = InlineMarkdown.parse(source).let { parsed ->
    parsed.spans.map { parsed.text.substring(it.start, it.end) to it.style }
  }

  @Test
  fun emphasisCodeAndStrike() {
    val parsed = InlineMarkdown.parse("a **bold** _it_ `x*y` ~~gone~~")
    assertEquals("a bold it x*y gone", parsed.text)
    assertEquals(
      listOf(
        "bold" to InlineMarkdown.Style.Bold,
        "it" to InlineMarkdown.Style.Italic,
        "x*y" to InlineMarkdown.Style.Code,
        "gone" to InlineMarkdown.Style.Strike,
      ),
      styles("a **bold** _it_ `x*y` ~~gone~~"),
    )
  }

  @Test
  fun linksAndAutolinks() {
    val parsed = InlineMarkdown.parse("see [the **docs**](https://d.dev \"title\") or <https://e.dev>")
    assertEquals("see the docs or https://e.dev", parsed.text)
    assertEquals(listOf("https://d.dev", "https://e.dev"), parsed.links)
  }

  @Test
  fun literalsStayLiteral() {
    assertEquals("snake_case_name and 2 * 3 * 4", InlineMarkdown.parse("snake_case_name and 2 * 3 * 4").text)
    assertEquals("*not emphasis*", InlineMarkdown.parse("\\*not emphasis\\*").text)
    assertTrue(InlineMarkdown.parse("snake_case_name").spans.isEmpty())
    assertTrue(InlineMarkdown.parse("unclosed `tick").spans.isEmpty())
  }
}

class WorkLogLabelTest {
  private fun tool(id: String, at: Double?): RemoteMessage {
    val stamp = at?.let { ""","timestamp":$it""" } ?: ""
    val json =
      """{"id":"$id","role":"assistant","text_blocks":[],"tool_calls":[{"id":"c-$id","name":"Read","input":{},"result_blocks":[],"status":"done"}]$stamp}"""
    return ProtocolJson.json.decodeFromString(RemoteMessage.serializer(), json)
  }

  private val now = 1_000_000.0

  @Test
  fun finishedWorkReadsAsItsSpan() {
    assertEquals("Worked for 5m 29s", WorkLog("l", listOf(tool("a", 10_000.0)), 1_000.0, 330_000.0).label(false, now))
  }

  @Test
  fun workStillGoingCountsUpFromTheTurnsStart() {
    assertEquals("Working for 12s", WorkLog("l", listOf(tool("a", 900_000.0)), started = 988_000.0).label(true, now))
    assertEquals("Working", WorkLog("l", emptyList()).label(true, now))
  }

  @Test
  fun noSpanFallsBackToItsOwnMessagesThenTheCallCount() {
    assertEquals("Worked for 3s", WorkLog("l", listOf(tool("a", 1_000.0), tool("b", 4_000.0))).label(false, now))
    assertEquals("1 tool call", WorkLog("l", listOf(tool("a", null))).label(false, now))
    assertEquals("2 tool calls", WorkLog("l", listOf(tool("a", 1.0), tool("b", 1.0))).callCountLabel)
  }

  @Test
  fun backgroundWorkStillRunningIsAppended() {
    val log = WorkLog("l", listOf(tool("a", null)), 1_000.0, 3_000.0, "1 agent still running")
    assertEquals("Worked for 2s · 1 agent still running", log.label(false, now))
  }
}

class MessageMenuTest {
  private fun message(id: String, role: RemoteMessageRole, text: String = "hi") =
    RemoteMessage(id, role, listOf(text), emptyList())

  @Test
  fun copyForTextEditForYourOwnForkForBothWhileLive() {
    val live = MessageMenu(canChange = true) { _, _ -> }
    val watch = MessageMenu(canChange = false) { _, _ -> }
    assertEquals(
      listOf(MessageMenuAction.Copy, MessageMenuAction.Edit, MessageMenuAction.Fork),
      menuActions(live, message("u", RemoteMessageRole.user)),
    )
    assertEquals(listOf(MessageMenuAction.Copy, MessageMenuAction.Fork), menuActions(live, message("a", RemoteMessageRole.assistant)))
    assertEquals(listOf(MessageMenuAction.Copy), menuActions(watch, message("u", RemoteMessageRole.user)))
    assertTrue(menuActions(live, message("optimistic-1", RemoteMessageRole.user)).isEmpty())
    assertTrue(menuActions(null, message("u", RemoteMessageRole.user)).isEmpty())
  }

  @Test
  fun signInPopupsStayInTheArtifact() {
    assertTrue(isSignInHost("claude.ai"))
    assertTrue(isSignInHost("accounts.google.com"))
    assertTrue(isSignInHost("console.anthropic.com"))
    assertFalse(isSignInHost("evilclaude.ai"))
    assertFalse(isSignInHost(null))
  }
}
