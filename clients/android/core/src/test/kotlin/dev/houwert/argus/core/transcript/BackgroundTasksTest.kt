package dev.houwert.argus.core.transcript

import dev.houwert.argus.kit.protocol.generated.RemoteBackgroundTask
import dev.houwert.argus.kit.protocol.generated.RemoteBackgroundTaskStatus
import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class BackgroundTasksTest {
  private fun message(vararg calls: Pair<String, String?>): RemoteMessage {
    val json = calls.mapIndexed { index, (name, background) ->
      val bg = background?.let { ""","background":{"status":"$it","started_at":1000,"duration_ms":5000}""" } ?: ""
      """{"id":"c$index","name":"$name","input":{},"result_blocks":[],"status":"done"$bg}"""
    }.joinToString(",")
    return decodeMessage("""{"id":"m","role":"assistant","text_blocks":[],"tool_calls":[$json]}""")
  }

  @Test fun aBackgroundCallDecodesWithItsTiming() {
    val call = message("Agent" to "completed").toolCalls[0]
    assertEquals(RemoteBackgroundTask(RemoteBackgroundTaskStatus.completed, 1000.0, 5000.0), call.background)
  }

  @Test fun anUnknownStatusStillSettlesTheTask() {
    // Swift folds an unknown status into `.stopped`; here it stays raw, and anything but running is settled.
    val messages = listOf(message("Bash" to "killed"))
    assertEquals(emptyList(), BackgroundTasks.running(messages))
    assertEquals(6000.0, BackgroundTasks.lastFinished(messages))
  }

  @Test fun onlyCallsStillRunningInTheBackgroundCount() {
    val messages = listOf(message("Agent" to "running", "Agent" to "completed", "Read" to null))
    assertEquals(listOf("c0"), BackgroundTasks.running(messages).map { it.id })
  }

  @Test fun labelsNameAgentsElseBackgroundTasks() {
    val agents = BackgroundTasks.running(listOf(message("Agent" to "running", "Task" to "running")))
    assertEquals("1 agent still running", BackgroundTasks.stillRunningLabel(agents.take(1)))
    assertEquals("2 agents still running", BackgroundTasks.stillRunningLabel(agents))
    val mixed = BackgroundTasks.running(listOf(message("Agent" to "running", "Bash" to "running")))
    assertEquals("2 background tasks still running", BackgroundTasks.stillRunningLabel(mixed))
    assertNull(BackgroundTasks.stillRunningLabel(emptyList()))
  }
}
