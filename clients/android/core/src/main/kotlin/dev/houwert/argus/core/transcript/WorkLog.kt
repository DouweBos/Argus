package dev.houwert.argus.core.transcript

import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteMessageRole
import dev.houwert.argus.kit.util.ToolGroups

/** A turn's folded work and the span it took. */
data class WorkLog(
  val id: String,
  val messages: List<RemoteMessage>,
  /** When the turn began: the message before the log, epoch milliseconds. */
  val started: Double? = null,
  /** When the work ended: the reply after it, else its own last message; null while it's the newest thing in the chat. */
  val ended: Double? = null,
  /** What the turn launched in the background that hasn't reported back. */
  val stillRunning: String? = null,
)

/** A transcript row between the strips above and below the history: a message, or a turn's folded work. */
sealed interface TranscriptItem {
  val id: String

  data class Message(val message: RemoteMessage) : TranscriptItem {
    override val id: String get() = message.id
  }

  /** A run segment's messages, only ever drawn unfolded. */
  data class Run(val messages: List<RemoteMessage>) : TranscriptItem {
    override val id: String get() = "group-${messages.firstOrNull()?.id ?: ""}"
  }

  data class Work(val log: WorkLog) : TranscriptItem {
    override val id: String get() = log.id
  }
}

/** A chat's rows kept current incrementally: only the segments and work logs a change touches are rebuilt. */
class TranscriptItems(hoistImageReads: Boolean = false, folding: ToolGroups.Folding = ToolGroups.Folding.TURNS) {
  val segments = TranscriptSegments(hoistImageReads, folding)
  var items: List<TranscriptItem> = emptyList()
    private set

  fun update(messages: List<RemoteMessage>): TranscriptSegments.Change {
    val regrouped = segments.update(messages)
    val change = segments.withWorkLogs(regrouped)
    if (change.isEmpty) return change
    val next = items.toMutableList()
    next.subList(change.removed.first, change.removed.last + 1).clear()
    next.addAll(change.removed.first, change.inserted.map(segments::item))
    for (index in change.reloaded) next[index] = segments.item(index)
    items = next
    return change
  }
}

/** The row for segment [position]: a collapsed segment is a work log when turns fold. */
fun TranscriptSegments.item(position: Int): TranscriptItem = when (val segment = segments[position]) {
  is ToolGroups.Segment.Single -> TranscriptItem.Message(segment.message)
  is ToolGroups.Segment.Collapsed ->
    if (folding == ToolGroups.Folding.TURNS) TranscriptItem.Work(workLog(position, segment.messages))
    else TranscriptItem.Run(segment.messages)
}

val TranscriptSegments.items: List<TranscriptItem> get() = segments.indices.map(::item)

/** A work log's span reads its neighbours: the message before it, and the reply after. */
private fun TranscriptSegments.workLog(position: Int, messages: List<RemoteMessage>): WorkLog {
  val all = segments
  // Past the turn's opening reply: the turn began with the message that asked.
  var prior = position - 1
  while (prior >= 0 && (all[prior] as? ToolGroups.Segment.Single)?.message?.let(ToolGroups::isReply) == true) prior -= 1
  val before = if (prior >= 0) all[prior].messages.lastOrNull()?.timestamp else null
  var ended: Double? = null
  if (position + 1 < all.size) {
    val next = all[position + 1].messages.firstOrNull()
    if (next != null) ended = if (next.role == RemoteMessageRole.assistant) next.timestamp else messages.lastOrNull()?.timestamp
  }
  val turnMessages = turn(position).flatMap { it.messages }
  val running = BackgroundTasks.running(turnMessages)
  // Background agents are part of the turn's work: it ends when the last of them does.
  val settled = BackgroundTasks.lastFinished(turnMessages)
  val end = ended
  if (settled != null && end != null && settled > end) ended = settled
  return WorkLog(all[position].id, messages, before, ended, BackgroundTasks.stillRunningLabel(running))
}

/** The segments from [position] to the end of its turn: the reply after the log is where a background launch usually sits. */
private fun TranscriptSegments.turn(position: Int): List<ToolGroups.Segment> {
  var end = position + 1
  while (end < segments.size && !TranscriptSegments.startsTurn(segments[end])) end += 1
  return segments.subList(position, end)
}

/**
 * [change] widened over the work logs it moves: one next to an inserted or removed row has a new
 * span, one whose turn changed may have new background work to count.
 */
fun TranscriptSegments.withWorkLogs(change: TranscriptSegments.Change): TranscriptSegments.Change {
  val widened = withTurnLogs(change)
  val reloaded = widened.reloaded.toMutableList()
  val changed = widened.reloaded + widened.inserted.toList()
  val anchors = if (widened.removed.isEmpty() && widened.inserted.isEmpty()) changed else {
    // The log before the edit ends at it.
    val before = widened.inserted.first - 1
    if (before in segments.indices && before !in reloaded && segments[before] is ToolGroups.Segment.Collapsed) {
      reloaded.add(before)
    }
    changed + before
  }
  // The log after a changed row, past the turn's opening reply, reads its start from it.
  for (index in anchors) {
    var next = index + 1
    while (next < segments.size && (segments[next] as? ToolGroups.Segment.Single)?.message?.let(ToolGroups::isReply) == true) {
      next += 1
    }
    if (next < segments.size && segments[next] is ToolGroups.Segment.Collapsed && next !in widened.inserted && next !in reloaded) {
      reloaded.add(next)
    }
  }
  return widened.copy(reloaded = reloaded)
}

/** The work log opening each changed segment's turn. */
private fun TranscriptSegments.withTurnLogs(change: TranscriptSegments.Change): TranscriptSegments.Change {
  val reloaded = change.reloaded.toMutableList()
  for (index in change.reloaded + change.inserted.toList()) {
    var log = index - 1
    while (log >= 0 && !TranscriptSegments.startsTurn(segments[log])) {
      if (segments[log] is ToolGroups.Segment.Collapsed) {
        if (log !in change.inserted && log !in reloaded) reloaded.add(log)
        break
      }
      log -= 1
    }
  }
  return change.copy(reloaded = reloaded)
}
