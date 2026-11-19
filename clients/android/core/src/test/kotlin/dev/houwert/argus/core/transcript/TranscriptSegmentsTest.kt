package dev.houwert.argus.core.transcript

import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteMessageRole
import dev.houwert.argus.kit.util.ToolGroups
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TranscriptSegmentsTest {
  private fun text(id: String, body: String = "hi") = textMessage(id, text = listOf(body))

  private fun tool(id: String, name: String = "Read") = decodeMessage(
    """{"id":"$id","role":"assistant","text_blocks":[],"tool_calls":[{"id":"c-$id","name":"$name","input":{},"result_blocks":[],"status":"done"}]}""",
  )

  private fun hidden(id: String) = textMessage(id)

  private fun user(id: String) = textMessage(id, RemoteMessageRole.user, listOf("go"))

  private fun assertMatchesFullGrouping(segments: TranscriptSegments, messages: List<RemoteMessage>) {
    val full = ToolGroups.group(messages)
    assertEquals(full.map { it.id }, segments.segments.map { it.id })
    assertEquals(full.map { it.messages }, segments.segments.map { it.messages })
  }

  @Test fun appendingToAToolRunReloadsTheGroupInsteadOfRebuilding() {
    val segments = TranscriptSegments()
    val messages = mutableListOf(text("a"), tool("b"), tool("c"))
    segments.update(messages.toList())
    messages.add(tool("d"))
    val change = segments.update(messages.toList())
    assertMatchesFullGrouping(segments, messages)
    assertTrue(change.removed.isEmpty() && change.inserted.isEmpty())
    assertEquals(listOf(1), change.reloaded)
  }

  @Test fun streamingIntoTheLastMessageReloadsOneSegment() {
    val segments = TranscriptSegments()
    val messages = (0 until 50).map { text("m$it") }.toMutableList()
    segments.update(messages.toList())
    messages[49] = text("m49", "hi there")
    val change = segments.update(messages.toList())
    assertTrue(change.removed.isEmpty() && change.inserted.isEmpty())
    assertEquals(listOf(49), change.reloaded)
  }

  @Test fun anOlderPagePrependsRowsAndLeavesTheRestAlone() {
    val segments = TranscriptSegments()
    val tail = (10 until 20).map { text("m$it") }
    segments.update(tail)
    val page = (0 until 10).map { text("m$it") }
    val change = segments.update(page + tail)
    assertMatchesFullGrouping(segments, page + tail)
    assertTrue(change.removed.isEmpty())
    assertEquals(0 until 10, change.inserted)
    assertTrue(change.reloaded.isEmpty())
  }

  @Test fun aPageWhoseLastToolCallJoinsTheFirstRunAboveMergesThem() {
    val segments = TranscriptSegments()
    val tail = listOf(tool("t1"), tool("t2"), text("x"))
    segments.update(tail)
    val all = listOf(text("a"), tool("t0")) + tail
    segments.update(all)
    assertMatchesFullGrouping(segments, all)
    assertEquals(listOf("a", "group-t0", "x"), segments.segments.map { it.id })
  }

  @Test fun findsTheSegmentHoldingAMessageFoldedIntoAGroup() {
    val segments = TranscriptSegments()
    segments.update(listOf(text("a"), tool("b"), hidden("h"), tool("c"), text("d")))
    assertEquals(1, segments.segmentIndex("c"))
    assertEquals(2, segments.segmentIndex("d"))
    assertNull(segments.segmentIndex("h"))
  }

  @Test fun aReplyLandingAfterATurnsWorkKeepsTheWorkFolded() {
    val segments = TranscriptSegments(folding = ToolGroups.Folding.TURNS)
    val messages = mutableListOf(user("u"), text("a", "looking"), tool("b"))
    segments.update(messages.toList())
    assertEquals(listOf("u", "group-a"), segments.segments.map { it.id })
    messages.add(text("r", "done"))
    val change = segments.update(messages.toList())
    assertEquals(listOf("u", "group-a", "r"), segments.segments.map { it.id })
    assertTrue(change.removed.isEmpty())
    assertEquals(2 until 3, change.inserted)
  }

  @Test fun randomEditsAlwaysMatchGroupingTheWholeChat() {
    for (folding in ToolGroups.Folding.entries) randomEdits(folding, Random(folding.ordinal + 1))
  }

  private fun randomEdits(folding: ToolGroups.Folding, rng: Random) {
    repeat(200) {
      val segments = TranscriptSegments(folding = folding)
      val messages = mutableListOf<RemoteMessage>()
      var next = 0
      fun make(): RemoteMessage {
        next += 1
        return when (rng.nextInt(7)) {
          0, 1 -> text("n$next")
          2 -> hidden("n$next")
          3 -> tool("n$next", "Edit")
          4 -> user("n$next")
          else -> tool("n$next")
        }
      }
      repeat(30) {
        val before = segments.segments
        when (val op = rng.nextInt(6)) {
          0 -> repeat(rng.nextInt(1, 5)) { messages.add(make()) }
          1 -> messages.addAll(0, List(rng.nextInt(1, 13)) { make() })
          else -> if (messages.isEmpty() || op == 5) {
            messages.add(make())
          } else {
            val index = rng.nextInt(messages.size)
            when (op) {
              2 -> {
                val replacement = make()
                messages[index] = replacement.copy(id = messages[index].id)
              }
              3 -> messages.removeAt(index)
              else -> messages.add(index, make())
            }
          }
        }
        val change = segments.update(messages.toList())
        val full = if (folding == ToolGroups.Folding.TURNS) ToolGroups.groupTurns(messages) else ToolGroups.group(messages)
        assertEquals(full.map { it.id }, segments.segments.map { it.id })
        assertEquals(full.map { it.messages }, segments.segments.map { it.messages })
        // The change, applied to the old ids, gives the new ones.
        val ids = before.map { it.id }.toMutableList()
        ids.subList(change.removed.first, change.removed.last + 1).clear()
        ids.addAll(change.removed.first, segments.segments.slice(change.inserted).map { it.id })
        assertEquals(segments.segments.map { it.id }, ids)
      }
    }
  }
}
