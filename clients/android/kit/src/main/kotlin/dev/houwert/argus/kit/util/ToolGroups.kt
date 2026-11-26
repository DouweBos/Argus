package dev.houwert.argus.kit.util

import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteMessageRole
import dev.houwert.argus.kit.protocol.generated.RemoteToolCall
import dev.houwert.argus.kit.protocol.generated.RemoteToolCallChild
import dev.houwert.argus.kit.protocol.generated.RemoteToolCallStatus
import dev.houwert.argus.kit.protocol.generated.RemoteToolResultBlock

/** Folding runs of tool-only messages into one collapsed row, ported from `toolGroups.ts`. */
object ToolGroups {
  /** A lone call is left expanded; folding one row saves nothing. */
  const val MIN_RUN = 2

  /** Calls that carry the substance of a turn, so a message containing one is never folded away. */
  private val substantive = setOf("Agent", "Edit", "MultiEdit", "Write")

  private fun String.isBlankText() = trim().isEmpty()

  /** [hoistImageReads]: image reads show open (a user setting), and an open card in a folded group is hidden all the same. */
  fun isToolCallOnly(message: RemoteMessage, hoistImageReads: Boolean = false): Boolean {
    if (message.role != RemoteMessageRole.assistant || message.toolCalls.isEmpty()) return false
    if (!message.textBlocks.all { it.isBlankText() }) return false
    return message.toolCalls.none {
      it.name in substantive || isPushNotification(it) || awaitsDecision(it) ||
        ArtifactLink.action(it) != null || (hoistImageReads && isImageRead(it))
    }
  }

  /** The agent deliberately reached for your phone; never fold that away. */
  fun isPushNotification(call: RemoteToolCall): Boolean = call.name == "mcp__argus__push_notification"

  fun isImageRead(call: RemoteToolCall): Boolean =
    call.name == "Read" && call.resultBlocks.any { it is RemoteToolResultBlock.Image }

  /** A call waiting on approval, here or in a sub-agent under it, must never be folded out of sight. */
  fun awaitsDecision(call: RemoteToolCall): Boolean {
    if (call.status == RemoteToolCallStatus.pending || call.pendingPermission == true) return true
    return call.children.orEmpty().any { it is RemoteToolCallChild.ToolUse && awaitsDecision(it.value.toolCall) }
  }

  /** Thinking- or usage-only messages have nothing to draw, and would split runs that should fold together. */
  fun hasVisibleContent(message: RemoteMessage): Boolean =
    message.toolCalls.isNotEmpty() || !message.images.isNullOrEmpty() || message.isError == true ||
      message.textBlocks.any { !it.isBlankText() }

  sealed interface Segment {
    val id: String

    data class Collapsed(val messages: List<RemoteMessage>) : Segment {
      override val id: String get() = "group-${messages.firstOrNull()?.id ?: ""}"
    }

    data class Single(val message: RemoteMessage) : Segment {
      override val id: String get() = message.id
    }
  }

  fun group(messages: List<RemoteMessage>, hoistImageReads: Boolean = false): List<Segment> {
    val segments = mutableListOf<Segment>()
    val run = mutableListOf<RemoteMessage>()
    fun flush() {
      if (run.isEmpty()) return
      if (run.size >= MIN_RUN) segments.add(Segment.Collapsed(run.toList())) else run.mapTo(segments, Segment::Single)
      run.clear()
    }
    for (message in messages) {
      if (!hasVisibleContent(message)) continue
      if (isToolCallOnly(message, hoistImageReads)) {
        run.add(message)
      } else {
        flush()
        segments.add(Segment.Single(message))
      }
    }
    flush()
    return segments
  }

  // Turns

  /** How a chat folds: runs of tool-only messages, or each turn's work as one log. */
  enum class Folding { RUNS, TURNS }

  /** What a turn's work log never folds away: errors, pending decisions, a push, an Artifact, another agent's message. */
  fun staysOpen(message: RemoteMessage, hoistImageReads: Boolean = false): Boolean =
    message.isError == true || message.source != null || message.author != null ||
      message.toolCalls.any {
        isPushNotification(it) || awaitsDecision(it) || ArtifactLink.action(it) != null ||
          (hoistImageReads && isImageRead(it))
      }

  /** Text and nothing else: what the agent says rather than does. */
  fun isReply(message: RemoteMessage): Boolean =
    message.role == RemoteMessageRole.assistant && message.toolCalls.isEmpty() && message.images.isNullOrEmpty() &&
      message.textBlocks.any { !it.isBlankText() }

  /**
   * Each assistant turn's calls and narration as one collapsed segment; the user's messages, the
   * turn's opening and closing replies and whatever [staysOpen] stand alone. Work with no tool call isn't folded.
   */
  fun groupTurns(messages: List<RemoteMessage>, hoistImageReads: Boolean = false): List<Segment> =
    foldTurns(messages.withIndex().map { it.index to it.value }, hoistImageReads).map { it.segment }

  data class IndexedSegment(val start: Int, val segment: Segment)

  /** [groupTurns] over indexed messages, with each segment's first index. */
  fun foldTurns(messages: List<Pair<Int, RemoteMessage>>, hoistImageReads: Boolean = false): List<IndexedSegment> {
    val segments = mutableListOf<IndexedSegment>()
    val work = mutableListOf<Pair<Int, RemoteMessage>>()

    fun flush() {
      if (work.isEmpty()) return
      // Text before the first tool call often answers the question; it stays open like the closing reply.
      var head = 0
      while (head < work.size && isReply(work[head].second)) head += 1
      var tail = work.size
      while (tail > head && isReply(work[tail - 1].second)) tail -= 1
      work.subList(0, head).mapTo(segments) { IndexedSegment(it.first, Segment.Single(it.second)) }
      val folded = work.subList(head, tail)
      if (folded.any { it.second.toolCalls.isNotEmpty() }) {
        segments.add(IndexedSegment(folded[0].first, Segment.Collapsed(folded.map { it.second })))
      } else {
        folded.mapTo(segments) { IndexedSegment(it.first, Segment.Single(it.second)) }
      }
      work.subList(tail, work.size).mapTo(segments) { IndexedSegment(it.first, Segment.Single(it.second)) }
      work.clear()
    }

    for ((index, message) in messages) {
      if (!hasVisibleContent(message)) continue
      if (message.role != RemoteMessageRole.assistant || staysOpen(message, hoistImageReads)) {
        flush()
        segments.add(IndexedSegment(index, Segment.Single(message)))
      } else {
        work.add(index to message)
      }
    }
    flush()
    return segments
  }

  enum class ToolCategory { READ, SEARCH, BASH, EDIT, WEB, AGENT, OTHER }

  fun category(name: String): ToolCategory = when (name) {
    "Read", "LS", "NotebookRead" -> ToolCategory.READ
    "Grep", "Glob" -> ToolCategory.SEARCH
    "Bash", "BashOutput", "KillShell" -> ToolCategory.BASH
    "Edit", "MultiEdit", "Write", "NotebookEdit" -> ToolCategory.EDIT
    "WebFetch", "WebSearch" -> ToolCategory.WEB
    "Agent", "Task" -> ToolCategory.AGENT
    else -> ToolCategory.OTHER
  }

  /** Call counts per category, in the order each category first appears. */
  fun categorize(messages: List<RemoteMessage>): List<Pair<ToolCategory, Int>> {
    val counts = linkedMapOf<ToolCategory, Int>()
    for (message in messages) for (call in message.toolCalls) counts.merge(category(call.name), 1, Int::plus)
    return counts.map { it.key to it.value }
  }

  fun countToolCalls(messages: List<RemoteMessage>): Int = messages.sumOf { it.toolCalls.size }
}
