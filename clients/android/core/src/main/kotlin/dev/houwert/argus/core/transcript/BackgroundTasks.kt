package dev.houwert.argus.core.transcript

import dev.houwert.argus.kit.protocol.generated.RemoteBackgroundTaskStatus
import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteToolCall
import dev.houwert.argus.kit.util.ToolCallSummary

/**
 * Calls launched with `run_in_background`: the host marks them running until the CLI's task
 * notification settles them. Mirrors the host's `background.ts`.
 */
object BackgroundTasks {
  /** The messages' own calls still running in the background. */
  fun running(messages: List<RemoteMessage>): List<RemoteToolCall> =
    messages.flatMap { message -> message.toolCalls.filter { it.background?.status == RemoteBackgroundTaskStatus.running } }

  /** When the last settled background call finished, epoch milliseconds. Any status but running counts as settled. */
  fun lastFinished(messages: List<RemoteMessage>): Double? =
    messages.flatMap { it.toolCalls }.mapNotNull { call ->
      val task = call.background ?: return@mapNotNull null
      val duration = task.durationMs ?: return@mapNotNull null
      if (task.status == RemoteBackgroundTaskStatus.running) null else task.startedAt + duration
    }.maxOrNull()

  /** "1 agent still running", "2 background tasks still running", or null. */
  fun stillRunningLabel(calls: List<RemoteToolCall>): String? {
    val count = calls.size
    if (count == 0) return null
    if (calls.all { ToolCallSummary.isSubagent(it.name) }) {
      return "$count ${if (count == 1) "agent" else "agents"} still running"
    }
    return "$count background ${if (count == 1) "task" else "tasks"} still running"
  }
}
