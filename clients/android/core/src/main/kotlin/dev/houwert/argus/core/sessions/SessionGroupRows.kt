package dev.houwert.argus.core.sessions

import dev.houwert.argus.core.compare.CompareGroup
import dev.houwert.argus.core.compare.CompareSessionRow
import dev.houwert.argus.kit.protocol.generated.RemoteSession

/** Where a session row sits among its siblings. */
data class SessionRowPlacement(
  /** A compare run's slot, under its run's header. */
  val slot: Boolean = false,
  val indent: Int = 0,
  val stacked: Boolean = false,
  /** The stack parent it's on, when that parent is listed elsewhere. */
  val caption: String? = null,
)

/**
 * Session groups as rows: a compare run's slots under its header, a stacked session under its
 * parent. The phone's Home and project screen both list sessions this way.
 */
sealed interface SessionListRow {
  val key: String

  data class Session(val group: SessionGroup, val placement: SessionRowPlacement) : SessionListRow {
    override val key get() = "s:${group.id}"
  }

  data class CompareHeader(val run: CompareGroup) : SessionListRow {
    override val key get() = "c:${run.id}"
  }

  companion object {
    fun make(groups: List<SessionGroup>, all: List<RemoteSession>): List<SessionListRow> {
      val arranged = SessionStack.arrange(groups, { it.session }, all)
      return CompareSessionRow.make(arranged.items).flatMap { item ->
        when (item) {
          is CompareSessionRow.Session -> {
            val nesting = arranged.nesting[item.group.id] ?: SessionStack.Nesting.none
            listOf(Session(item.group, SessionRowPlacement(indent = nesting.depth, stacked = nesting.depth > 0, caption = nesting.caption)))
          }
          is CompareSessionRow.Compare ->
            listOf(CompareHeader(item.run)) + item.slots.map { Session(it, SessionRowPlacement(slot = true, indent = 1)) }
        }
      }
    }
  }
}
