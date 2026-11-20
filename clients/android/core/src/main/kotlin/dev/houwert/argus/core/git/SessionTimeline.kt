package dev.houwert.argus.core.git

import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteSessionTurn
import dev.houwert.argus.kit.protocol.generated.RemoteTimelineRestore
import dev.houwert.argus.kit.protocol.generated.RemoteTimelineTurn

/** One agent turn on a session's timeline: what its prompt changed. */
data class TimelineTurn(
  val number: Int,
  val checkpointId: String,
  val agentId: String,
  /** The agent's chat title; null before one is generated. */
  val agentTitle: String? = null,
  val prompt: String,
  /** Unix ms the prompt was sent. */
  val timestamp: Double,
  /** False once its checkpoint is gone: nothing to diff or restore. */
  val available: Boolean = true,
  /** False while it runs, or when no end was recorded and no turn followed. */
  val finished: Boolean = true,
  val files: Int = 0,
  val additions: Int = 0,
  val deletions: Int = 0,
) {
  val id: String get() = checkpointId
  val canRestore: Boolean get() = available && finished

  /** The turn as the turn-scoped diff knows it. */
  val sessionTurn: RemoteSessionTurn get() = RemoteSessionTurn(number.toLong(), checkpointId, agentId, prompt, timestamp)

  companion object {
    fun of(wire: RemoteTimelineTurn) = TimelineTurn(
      wire.number.toInt(), wire.checkpointId, wire.agentId, wire.agentTitle, wire.prompt, wire.timestamp,
      wire.available, wire.finished, wire.files.toInt(), wire.additions.toInt(), wire.deletions.toInt(),
    )
  }
}

/** The files put back to where a turn ended. */
data class TimelineRestore(
  val id: String,
  val checkpointId: String,
  val turnNumber: Int,
  val timestamp: Double,
  val undoneAt: Double? = null,
  /** Only the latest restore can be undone, and only once. */
  val canUndo: Boolean,
) {
  companion object {
    fun of(wire: RemoteTimelineRestore) =
      TimelineRestore(wire.id, wire.checkpointId, wire.turnNumber.toInt(), wire.timestamp, wire.undoneAt, wire.canUndo)
  }
}

/** A row on the timeline. */
sealed interface TimelineEntry {
  val id: String
  val timestamp: Double

  data class Turn(val turn: TimelineTurn) : TimelineEntry {
    override val id get() = "turn:${turn.checkpointId}"
    override val timestamp get() = turn.timestamp
  }

  data class Restore(val restore: TimelineRestore) : TimelineEntry {
    override val id get() = "restore:${restore.id}"
    override val timestamp get() = restore.timestamp
  }
}

/** A session's agent turns (oldest first) and the restores between them. */
data class SessionTimeline(
  val turns: List<TimelineTurn> = emptyList(),
  val restores: List<TimelineRestore> = emptyList(),
  /** An agent in the session is mid-turn, so restoring is refused. */
  val busy: Boolean = false,
) {
  /** Newest first; a restore sits above the turn it came after. */
  val entries: List<TimelineEntry>
    get() = (turns.map { TimelineEntry.Turn(it) } + restores.map { TimelineEntry.Restore(it) })
      .withIndex()
      .sortedWith(compareByDescending<IndexedValue<TimelineEntry>> { it.value.timestamp }.thenByDescending { it.index })
      .map { it.value }

  /** The turn a route names, else the newest one that can be diffed. */
  fun turn(checkpointId: String?): TimelineTurn? {
    if (checkpointId != null) turns.firstOrNull { it.checkpointId == checkpointId }?.let { return it }
    return turns.lastOrNull { it.available }
  }

  /** The restore that can still be undone, if any. */
  val undoable: TimelineRestore? get() = restores.lastOrNull { it.canUndo }

  companion object {
    fun of(wire: MethodsTypes.SessionsTimelineResult) =
      SessionTimeline(wire.turns.map(TimelineTurn::of), wire.restores.map(TimelineRestore::of), wire.busy)
  }
}
