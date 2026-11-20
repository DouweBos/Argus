package dev.houwert.argus.ui.transcript

import dev.houwert.argus.core.transcript.WorkLog
import dev.houwert.argus.kit.util.ToolGroups
import dev.houwert.argus.ui.components.ChromeText

/**
 * "Worked for 5m 29s", "Working for 12s" while the agent is still at it, or the call count when
 * there's no span; plus whatever is still running.
 */
fun WorkLog.label(working: Boolean, nowMillis: Double): String {
  val base = workLabel(working, nowMillis)
  return stillRunning?.let { "$base · $it" } ?: base
}

/** "3 tool calls". */
val WorkLog.callCountLabel: String
  get() {
    val count = ToolGroups.countToolCalls(messages)
    return "$count tool call${if (count == 1) "" else "s"}"
  }

private fun WorkLog.workLabel(working: Boolean, nowMillis: Double): String {
  if (working) {
    val started = started ?: return "Working"
    return "Working for ${ChromeText.duration((nowMillis - started) / 1000)}"
  }
  val end = ended ?: messages.lastOrNull()?.timestamp
  val start = started ?: messages.firstOrNull()?.timestamp
  if (start == null || end == null || end <= start) return callCountLabel
  return "Worked for ${ChromeText.duration((end - start) / 1000)}"
}
