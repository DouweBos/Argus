package dev.houwert.argus.kit.util

import dev.houwert.argus.kit.protocol.generated.RemoteToolCallChild
import dev.houwert.argus.kit.protocol.generated.RemoteToolCallChildText
import dev.houwert.argus.kit.protocol.generated.RemoteToolCallChildToolUse
import dev.houwert.argus.kit.protocol.generated.RemoteToolCallStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ToolCallSummaryTest {
  private fun call(id: String, name: String, children: List<RemoteToolCallChild>? = null) =
    toolCall(id, name, children = children, status = RemoteToolCallStatus.running)

  private fun text(text: String) = RemoteToolCallChild.Text(RemoteToolCallChildText("text", text))

  @Test fun previewKeepsTheNewestCallsAndCountsTheRest() {
    val children = listOf(text("Looking around.")) +
      (1..8).map { RemoteToolCallChild.ToolUse(RemoteToolCallChildToolUse("tool_use", call("c$it", "Read"))) }
    val preview = ToolCallSummary.subagentPreview(call("a", "Agent", children))
    assertEquals(listOf("c4", "c5", "c6", "c7", "c8"), preview.calls.map { it.id })
    assertEquals(3, preview.earlier)
  }

  @Test fun previewOfASubagentWithNoCallsIsEmpty() {
    val preview = ToolCallSummary.subagentPreview(call("a", "Agent", listOf(text("Thinking."))))
    assertTrue(preview.calls.isEmpty())
    assertEquals(0, preview.earlier)
  }

  @Test fun anAgentCallGoesByItsSubagentType() {
    assertEquals("Explore", ToolCallSummary.label("Agent", mapOf("subagent_type" to str("Explore"))))
    assertEquals("Agent", ToolCallSummary.label("Agent", emptyMap()))
    assertEquals("Read", ToolCallSummary.label("Read", emptyMap()))
  }
}
