package dev.houwert.argus.core.git

import dev.houwert.argus.core.stores.StoreEvent
import dev.houwert.argus.kit.protocol.generated.RemoteSessionTurn

/** What a session's diff covers: the working copy, one agent turn, or the whole branch. */
sealed interface SessionDiffScope {
  data object Uncommitted : SessionDiffScope
  data object LastTurn : SessionDiffScope
  data class Turn(val turn: RemoteSessionTurn) : SessionDiffScope
  data object Branch : SessionDiffScope

  val title: String
    get() = when (this) {
      Uncommitted -> "Uncommitted"
      LastTurn -> "Last Turn"
      is Turn -> "Turn ${turn.number}"
      Branch -> "Whole Branch"
    }

  /** The turn it shows, picked out of [turns]: the latest for [LastTurn]. */
  fun turn(turns: List<RemoteSessionTurn>): RemoteSessionTurn? = when (this) {
    LastTurn -> turns.lastOrNull()
    is Turn -> turns.firstOrNull { it.checkpointId == turn.checkpointId }
    Uncommitted, Branch -> null
  }

  /** How a review comment names what it was written against. A number, not "last", since more turns may follow. */
  fun reviewScope(turns: List<RemoteSessionTurn>): String = when (this) {
    Uncommitted -> "uncommitted changes"
    Branch -> "changes on the whole branch"
    LastTurn, is Turn -> turn(turns)?.let { "changes from turn ${it.number}" } ?: "changes from the last turn"
  }

  /** The scope as one route-friendly string: `working`, `branch`, `turn` (the latest) or `turn:<checkpoint>`. */
  val mode: String
    get() = when (this) {
      Uncommitted -> "working"
      Branch -> "branch"
      LastTurn -> "turn"
      is Turn -> "turn:${turn.checkpointId}"
    }

  /** For telemetry: which kind of scope, never which turn. */
  val kind: StoreEvent.DiffScopeKind
    get() = when (this) {
      Uncommitted -> StoreEvent.DiffScopeKind.Uncommitted
      LastTurn -> StoreEvent.DiffScopeKind.LastTurn
      is Turn -> StoreEvent.DiffScopeKind.Turn
      Branch -> StoreEvent.DiffScopeKind.Branch
    }

  companion object {
    /** Reads [mode] back, finding a pinned turn in [turns]; one that's gone reads as the last turn. */
    fun fromMode(mode: String, turns: List<RemoteSessionTurn>): SessionDiffScope = when (mode) {
      "working" -> Uncommitted
      "branch" -> Branch
      else -> {
        val id = if (mode.startsWith("turn:")) mode.removePrefix("turn:") else null
        turns.firstOrNull { it.checkpointId == id }?.let { Turn(it) } ?: LastTurn
      }
    }

    /** `sessions.diff`'s mode and turn for a [mode] string, without needing the turns. */
    fun wire(mode: String): Pair<String, String?> =
      if (mode.startsWith("turn:")) "turn" to mode.removePrefix("turn:") else mode to null
  }
}
