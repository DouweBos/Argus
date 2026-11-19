package dev.houwert.argus.core.transcript

import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteMessageRole
import dev.houwert.argus.kit.util.ToolGroups

/**
 * A chat's tool-group segments, regrouped only around what changed, so a stream update or an older
 * page costs the segments at that edge. Matches [ToolGroups.group] (or `groupTurns`) exactly.
 */
class TranscriptSegments(
  private val hoistImageReads: Boolean = false,
  val folding: ToolGroups.Folding = ToolGroups.Folding.RUNS,
) {
  var messages: List<RemoteMessage> = emptyList()
    private set
  var segments: List<ToolGroups.Segment> = emptyList()
    private set

  /** Index in [messages] of each segment's first message. */
  private var starts: List<Int> = emptyList()

  /** What [update] replaced: [removed] in the old segments became [inserted]; [reloaded] (new indices) kept their id but changed. */
  data class Change(val removed: IntRange, val inserted: IntRange, val reloaded: List<Int>) {
    val isEmpty: Boolean get() = removed.isEmpty() && inserted.isEmpty() && reloaded.isEmpty()

    companion object {
      val NONE = Change(0 until 0, 0 until 0, emptyList())
    }
  }

  fun update(new: List<RemoteMessage>): Change {
    val old = messages
    val shorter = minOf(old.size, new.size)
    var prefix = 0
    while (prefix < shorter && same(old[prefix], new[prefix])) prefix += 1
    if (prefix == old.size && prefix == new.size) return Change.NONE
    var suffix = 0
    while (suffix < shorter - prefix && same(old[old.size - 1 - suffix], new[new.size - 1 - suffix])) suffix += 1
    messages = new

    if (segments.isEmpty() || old.isEmpty()) {
      val (built, builtStarts) = group(new, 0 until new.size)
      val removed = 0 until segments.size
      segments = built
      starts = builtStarts
      return Change(removed, 0 until built.size, emptyList())
    }

    // The segments either side of the change, widened over neighbouring tool-only runs a changed
    // message could join or split, or to the whole turn when turns fold.
    var first = segment(maxOf(0, prefix - 1))
    var last = segment(minOf(old.size - 1, old.size - suffix))
    when (folding) {
      ToolGroups.Folding.RUNS -> {
        while (first > 0 && isToolRun(segments[first - 1])) first -= 1
        while (last < segments.size - 1 && isToolRun(segments[last + 1])) last += 1
      }
      ToolGroups.Folding.TURNS -> {
        while (first > 0 && !startsTurn(segments[first])) first -= 1
        while (last < segments.size - 1 && !startsTurn(segments[last + 1])) last += 1
      }
    }
    val oldStart = if (first == 0) 0 else starts[first]
    val oldEnd = if (last + 1 < starts.size) starts[last + 1] else old.size
    val delta = new.size - old.size
    val (built, builtStarts) = group(new, oldStart until oldEnd + delta)

    val replaced = segments.subList(first, last + 1).toList()
    segments = segments.subList(0, first) + built + segments.subList(last + 1, segments.size)
    starts = starts.subList(0, first) + builtStarts + starts.subList(last + 1, starts.size).map { it + delta }
    return change(replaced, built, first)
  }

  /** Index of the segment holding [messageId], if a visible one does. */
  fun segmentIndex(messageId: String): Int? {
    val position = messages.indexOfFirst { it.id == messageId }
    if (position < 0) return null
    val index = segment(position)
    return if (index in segments.indices && segments[index].holds(messageId)) index else null
  }

  // Grouping

  private fun same(a: RemoteMessage, b: RemoteMessage) = a.id == b.id && a == b

  /** The segment whose span covers message [index]; invisible messages belong to the segment before them. */
  private fun segment(index: Int): Int {
    var low = 0
    var high = starts.size - 1
    while (low < high) {
      val mid = (low + high + 1) / 2
      if (starts[mid] <= index) low = mid else high = mid - 1
    }
    return low
  }

  private fun isToolRun(segment: ToolGroups.Segment): Boolean = when (segment) {
    is ToolGroups.Segment.Collapsed -> true
    is ToolGroups.Segment.Single -> ToolGroups.isToolCallOnly(segment.message, hoistImageReads)
  }

  /** [ToolGroups.group] over [range], with each segment's first index. */
  private fun group(messages: List<RemoteMessage>, range: IntRange): Pair<List<ToolGroups.Segment>, List<Int>> {
    if (folding == ToolGroups.Folding.TURNS) {
      val folded = ToolGroups.foldTurns(range.map { it to messages[it] }, hoistImageReads)
      return folded.map { it.segment } to folded.map { it.start }
    }
    val segments = mutableListOf<ToolGroups.Segment>()
    val starts = mutableListOf<Int>()
    val run = mutableListOf<Pair<Int, RemoteMessage>>()

    fun flush() {
      if (run.isEmpty()) return
      if (run.size >= ToolGroups.MIN_RUN) {
        segments.add(ToolGroups.Segment.Collapsed(run.map { it.second }))
        starts.add(run[0].first)
      } else {
        for ((index, message) in run) {
          segments.add(ToolGroups.Segment.Single(message))
          starts.add(index)
        }
      }
      run.clear()
    }

    for (index in range) {
      val message = messages[index]
      if (!ToolGroups.hasVisibleContent(message)) continue
      if (ToolGroups.isToolCallOnly(message, hoistImageReads)) {
        run.add(index to message)
      } else {
        flush()
        segments.add(ToolGroups.Segment.Single(message))
        starts.add(index)
      }
    }
    flush()
    return segments to starts
  }

  companion object {
    /** A message of the user's (or the system's): a turn's work never folds across one. */
    internal fun startsTurn(segment: ToolGroups.Segment): Boolean =
      segment is ToolGroups.Segment.Single && segment.message.role != RemoteMessageRole.assistant

    /** Trims the ids both blocks share at either end, so a stream update to the last message is one reload. */
    private fun change(old: List<ToolGroups.Segment>, new: List<ToolGroups.Segment>, offset: Int): Change {
      var head = 0
      while (head < old.size && head < new.size && old[head].id == new[head].id) head += 1
      var tail = 0
      while (tail < old.size - head && tail < new.size - head && old[old.size - 1 - tail].id == new[new.size - 1 - tail].id) {
        tail += 1
      }
      val kept = (0 until head) + ((new.size - tail) until new.size)
      val reloaded = kept.filter { index ->
        val before = old[if (index < head) index else index - new.size + old.size]
        before.messages != new[index].messages
      }
      return Change(
        (offset + head) until (offset + old.size - tail),
        (offset + head) until (offset + new.size - tail),
        reloaded.map { it + offset },
      )
    }
  }
}

val ToolGroups.Segment.messages: List<RemoteMessage>
  get() = when (this) {
    is ToolGroups.Segment.Single -> listOf(message)
    is ToolGroups.Segment.Collapsed -> messages
  }

val ToolGroups.Segment.firstMessageId: String? get() = messages.firstOrNull()?.id

fun ToolGroups.Segment.holds(messageId: String): Boolean = when (this) {
  is ToolGroups.Segment.Single -> message.id == messageId
  is ToolGroups.Segment.Collapsed -> messages.any { it.id == messageId }
}
