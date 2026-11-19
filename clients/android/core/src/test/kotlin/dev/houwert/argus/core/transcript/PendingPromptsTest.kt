package dev.houwert.argus.core.transcript

import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteToolCall
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PendingPromptsTest {
  private data class Call(val id: String, val name: String, val input: String = "{}", val status: String = "pending")

  private fun message(id: String, vararg calls: Call): RemoteMessage {
    val toolCalls = calls.joinToString(",") {
      """{"id":"${it.id}","name":"${it.name}","input":${it.input},"result_blocks":[],"status":"${it.status}"}"""
    }
    return decodeMessage("""{"id":"$id","role":"assistant","text_blocks":[],"tool_calls":[$toolCalls]}""")
  }

  private fun call(name: String, input: String = "{}"): RemoteToolCall = message("m", Call("c", name, input)).toolCalls[0]

  @Test fun collectsPendingCallsInOrderAndSkipsAnsweredOnes() {
    val messages = listOf(message("a", Call("1", "Bash"), Call("2", "Read")), message("b", Call("3", "Edit")))
    assertEquals(listOf("1", "3"), PendingPrompts.calls(messages) { it.id != "2" }.map { it.id })
  }

  @Test fun onlyWalksTheTailOfTheTranscript() {
    val messages = (0 until 50).map { message("m$it", Call("c$it", "Bash")) }
    val pending = PendingPrompts.calls(messages) { true }
    assertEquals(40, pending.size)
    assertEquals("c10", pending.first().id)
  }

  @Test fun titlesFollowTheFormTheCallGets() {
    assertEquals("Permission needed", PendingPrompts.title(call("Bash")))
    assertEquals("Plan ready for review", PendingPrompts.title(call("ExitPlanMode", """{"plan":"Do it"}""")))
    val question = """{"questions":[{"question":"Which database?","header":"Storage","options":[{"label":"Postgres"}]}]}"""
    assertEquals("Question from the agent", PendingPrompts.title(call("AskUserQuestion", question)))
  }

  @Test fun pendingFollowsTheStoresPromptsAnswersAndAgentState() {
    val running = message("m", Call("1", "Bash", status = "running"), Call("2", "Bash"), Call("3", "Bash"))
    val pending = PendingPrompts.pendingCalls(
      "a", listOf(running),
      promptKeys = setOf(PendingPrompts.promptKey("a", "1")),
      answered = setOf(PendingPrompts.promptKey("a", "3")),
      agentState = RemoteAgentStatusStatus.running,
    )
    assertEquals(listOf("1", "2"), pending.map { it.id })
    val call = running.toolCalls[1]
    assertFalse(PendingPrompts.isToolCallPending("a", call, emptySet(), emptySet(), RemoteAgentStatusStatus.stopped))
    assertTrue(PendingPrompts.isToolCallPending("a", call, emptySet(), emptySet(), null))
  }
}
