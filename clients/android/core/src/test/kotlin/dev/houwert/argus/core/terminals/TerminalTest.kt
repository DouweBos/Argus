package dev.houwert.argus.core.terminals

import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.junit.Test

class TerminalFeedTest {
  private fun bytes(text: String) = text.toByteArray()

  private fun List<TerminalFeed.Output>.render() = map {
    when (it) {
      TerminalFeed.Output.Reset -> "reset"
      is TerminalFeed.Output.Data -> "data:${String(it.bytes)}"
      is TerminalFeed.Output.Exit -> "exit:${it.code}"
    }
  }

  @Test fun holdsLiveOutputUntilTheReplayLands() {
    val feed = TerminalFeed()
    feed.beginReplay()
    assertTrue(feed.live(TerminalFeed.Live.Data(bytes("a")), 4).isEmpty())
    assertTrue(feed.live(TerminalFeed.Live.Data(bytes("b")), 6).isEmpty())
    // `a` was sent before the replay's response, so the replay already has it.
    assertEquals(listOf("reset", "data:history a", "data:b"), feed.replay(bytes("history a"), null, 5).render())
  }

  @Test fun dropsEventsDeliveredLateButSentBeforeTheReplay() {
    val feed = TerminalFeed()
    feed.beginReplay()
    feed.replay(bytes("x"), null, 10)
    assertTrue(feed.live(TerminalFeed.Live.Data(bytes("old")), 9).isEmpty())
    assertEquals(listOf("data:new"), feed.live(TerminalFeed.Live.Data(bytes("new")), 11).render())
  }

  @Test fun anExitedTerminalReplaysItsExit() {
    val feed = TerminalFeed()
    feed.beginReplay()
    assertEquals(listOf("reset", "exit:2"), feed.replay(ByteArray(0), 2, 1).render())
  }
}

class TerminalTextTest {
  private fun text(chunks: List<String>, limit: Int = 1024) = TerminalText(limit).apply { chunks.forEach { append(it.toByteArray()) } }

  @Test fun dropsColoursAndTitles() {
    assertEquals("ready on :3000\nok\n", text(listOf("\u001B[32mready\u001B[0m on :3000\r\n", "\u001B]0;title\u0007ok\n")).text)
  }

  @Test fun holdsAnEscapeSplitAcrossChunks() {
    assertEquals("abc", text(listOf("a\u001B[3", "2mb\u001B", "[0mc")).text)
  }

  @Test fun holdsACharacterSplitAcrossChunks() {
    val text = TerminalText()
    val bytes = "é✓".toByteArray()
    text.append(bytes.copyOfRange(0, 3))
    text.append(bytes.copyOfRange(3, bytes.size))
    assertEquals("é✓", text.text)
  }

  @Test fun aBareCarriageReturnRedrawsTheLine() {
    assertEquals("done\n50%\n", text(listOf("done\n10%", "\r50%\r", "\n")).text)
  }

  @Test fun keepsTheTailFromALineStart() {
    val long = text(listOf("x".repeat(30) + "\n" + "tail\n"), limit = 10)
    assertEquals("tail\n", long.text)
    assertTrue(long.truncated)
  }
}
