package dev.houwert.argus.core.transcript

import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteMessageRole
import dev.houwert.argus.kit.util.LinkedProjects
import dev.houwert.argus.kit.util.ToolGroups
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

class WorkLogTest {
  private fun user(id: String, at: Double? = null, body: String = "do it") =
    textMessage(id, RemoteMessageRole.user, listOf(body), at)

  private fun reply(id: String, at: Double? = null, body: String = "done") =
    textMessage(id, RemoteMessageRole.assistant, listOf(body), at)

  private fun tool(
    id: String,
    at: Double? = null,
    background: String? = null,
    ranFor: Double? = null,
    text: String? = null,
    name: String = "Agent",
  ): RemoteMessage {
    val duration = ranFor?.let { ""","duration_ms":$it""" } ?: ""
    val bg = background?.let { ""","background":{"status":"$it","started_at":1000$duration}""" } ?: ""
    val stamp = at?.let { ""","timestamp":$it""" } ?: ""
    val blocks = text?.let { """["$it"]""" } ?: "[]"
    return decodeMessage(
      """{"id":"$id","role":"assistant","text_blocks":$blocks,"tool_calls":[{"id":"c-$id","name":"$name","input":{},"result_blocks":[],"status":"done"$bg}]$stamp}""",
    )
  }

  private fun logs(messages: List<RemoteMessage>): List<WorkLog> {
    val items = TranscriptItems()
    items.update(messages)
    return items.items.mapNotNull { (it as? TranscriptItem.Work)?.log }
  }

  @Test fun aLogSpansFromTheMessageBeforeItToTheReplyAfter() {
    val log = logs(listOf(user("u", 1000.0), tool("a", 2000.0), tool("b", 3000.0), reply("r", 9000.0)))
    assertEquals(listOf("group-a"), log.map { it.id })
    assertEquals(1000.0, log[0].started)
    assertEquals(9000.0, log[0].ended)
    assertEquals(listOf("a", "b"), log[0].messages.map { it.id })
  }

  @Test fun theNewestWorkHasNoEndYet() {
    assertNull(logs(listOf(user("u", 1000.0), tool("a", 2000.0)))[0].ended)
  }

  @Test fun workCutOffByTheNextUserMessageEndsAtItsOwnLastMessage() {
    val log = logs(listOf(user("u", 1000.0), tool("a", 2000.0), tool("b", 3000.0), user("v", 8000.0)))
    assertEquals(3000.0, log[0].ended)
  }

  @Test fun theFirstLogInAChatHasNoStart() {
    assertNull(logs(listOf(tool("a", 2000.0), reply("r", 3000.0)))[0].started)
  }

  @Test fun backgroundWorkAnywhereInTheTurnCountsTheNextTurnsDoesnt() {
    val log = logs(
      listOf(
        user("u"), tool("a", background = "running"), reply("r"),
        user("v"), tool("b", background = "running"), tool("c", background = "running"),
      ),
    )
    assertEquals(listOf("1 agent still running", "2 agents still running"), log.map { it.stillRunning })
    assertNull(logs(listOf(user("u"), tool("a", background = "completed"), reply("r")))[0].stillRunning)
  }

  @Test fun aTurnsWorkRunsUntilItsLastBackgroundAgentFinished() {
    val finished = logs(
      listOf(user("u", 500.0), tool("a", 1000.0, background = "completed", ranFor = 600_000.0), reply("r", 2000.0)),
    )
    assertEquals(601_000.0, finished[0].ended)
    val quick = logs(listOf(user("u", 500.0), tool("a", 1000.0, background = "completed", ranFor = 10.0), reply("r", 2000.0)))
    assertEquals(2000.0, quick[0].ended)
  }

  @Test fun aRunFoldHasNoWorkLog() {
    val items = TranscriptItems(folding = ToolGroups.Folding.RUNS)
    items.update(listOf(tool("a", name = "Read"), tool("b", name = "Read")))
    assertEquals(listOf<TranscriptItem>(TranscriptItem.Run(items.segments.segments[0].messages)), items.items)
  }

  @Test fun aReplyLandingAfterTheLogGivesItAnEnd() {
    val items = TranscriptItems()
    val messages = mutableListOf(user("u", 1000.0), tool("a", 2000.0), tool("b", 3000.0))
    items.update(messages.toList())
    messages.add(reply("r", 7000.0))
    val change = items.update(messages.toList())
    assertTrue(1 in change.reloaded)
    assertEquals(7000.0, assertIs<TranscriptItem.Work>(items.items[1]).log.ended)
  }

  @Test fun aBackgroundTaskSettlingInTheReplyReloadsTheTurnsLog() {
    val items = TranscriptItems()
    items.update(listOf(user("u"), tool("a"), tool("b", background = "running"), reply("r")))
    val change = items.update(listOf(user("u"), tool("a"), tool("b", background = "completed"), reply("r")))
    assertTrue(1 in change.reloaded)
    assertNull(assertIs<TranscriptItem.Work>(items.items[1]).log.stillRunning)
  }

  @Test fun incrementalRowsAlwaysMatchAFreshBuild() {
    for (seed in 0 until 30) {
      val rng = Random(seed + 1)
      val items = TranscriptItems()
      val messages = mutableListOf<RemoteMessage>()
      for (step in 0 until 40) {
        val time = step * 1000.0
        when (rng.nextInt(6)) {
          0 -> messages.add(user("u$step", time))
          1 -> messages.add(reply("r$step", time))
          2 -> messages.add(tool("t$step", time, background = "running"))
          3 -> if (messages.isNotEmpty()) {
            val index = rng.nextInt(messages.size)
            messages[index] = tool(messages[index].id, time, background = "completed")
          } else {
            messages.add(tool("t$step", time, text = "looking"))
          }
          4 -> if (messages.size > 3) {
            repeat(2) { messages.removeAt(0) }
          } else {
            messages.add(tool("t$step", time, text = "looking"))
          }
          else -> messages.add(tool("t$step", time, text = "looking"))
        }
        items.update(messages.toList())
        val fresh = TranscriptItems()
        fresh.update(messages.toList())
        assertEquals(fresh.items, items.items, "seed $seed step $step")
      }
    }
  }
}

class MessageDisplayTextTest {
  @Test fun blankBlocksAreDropped() {
    assertEquals(listOf("hi", "there"), textMessage("a", text = listOf("hi", "  \n", "there")).displayBlocks)
  }

  @Test fun theLinkedProjectsPreambleIsStrippedFromTheUsersWords() {
    val text = LinkedProjects.buildPreamble(listOf("/repo/a"), "look here")
    assertEquals(listOf("look here"), textMessage("u", RemoteMessageRole.user, listOf(text)).displayBlocks)
  }

  @Test fun aMessageThatOnlyLinksProjectsHasNothingToShow() {
    val text = LinkedProjects.buildPreamble(listOf("/repo/a"), "")
    assertTrue(textMessage("u", RemoteMessageRole.user, listOf(text)).displayBlocks.isEmpty())
  }

  @Test fun anEditGoesBackOutWithItsPreamble() {
    val text = LinkedProjects.buildPreamble(listOf("/repo/a"), "look here")
    val message = textMessage("u", RemoteMessageRole.user, listOf(text))
    assertEquals("look here", message.editableText)
    assertEquals(LinkedProjects.buildPreamble(listOf("/repo/a"), "look there"), message.resendText("look there"))
  }
}
