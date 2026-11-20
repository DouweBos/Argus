package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.LinearHistoryEvent
import dev.houwert.argus.kit.protocol.generated.LinearHistoryEventKind
import dev.houwert.argus.kit.protocol.generated.LinearIssueDetailStatusHistoryItem
import dev.houwert.argus.kit.protocol.generated.LinearWorkflowState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Linear's property menus and cards: the options with their number keys, how long the issue sat
 * in each status, and who last changed a property.
 */
object LinearIssueProperty {
  enum class Kind(val historyKind: LinearHistoryEventKind) {
    Status(LinearHistoryEventKind.status),
    Priority(LinearHistoryEventKind.priority),
    Assignee(LinearHistoryEventKind.assignee),
    Estimate(LinearHistoryEventKind.estimate),
    Cycle(LinearHistoryEventKind.cycle),
    Project(LinearHistoryEventKind.project),
  }

  /** One pickable value: a workflow state's id, or a priority's number. */
  data class Option(val id: String, val title: String, /** The digit that picks it while the menu is open. */ val key: Char?)

  /** The team's workflow in order, keyed 1 to 9 then 0, the rest unkeyed. */
  fun statusOptions(states: List<LinearWorkflowState>): List<Option> =
    states
      .sortedWith(compareBy({ LinearIssueBoard.typeRank(it.type) }, { it.position }))
      .mapIndexed { index, state ->
        val key = when {
          index < 9 -> '1' + index
          index == 9 -> '0'
          else -> null
        }
        Option(state.id, state.name, key)
      }

  /** Urgent to Low, then No priority; each keyed by Linear's own number. */
  val priorityOptions: List<Option>
    get() = LinearIssueBoard.priorityOrder.map { Option("$it", LinearIssueBoard.priorityLabel(it), '0' + it) }

  data class Stint(val name: String, val type: String, /** Milliseconds, summed over every visit. */ val duration: Double)

  /** Statuses in the order first entered, each with its total time. */
  fun timeInStatus(
    history: List<LinearIssueDetailStatusHistoryItem>,
    now: Double = System.currentTimeMillis().toDouble(),
  ): List<Stint> {
    val order = mutableListOf<String>()
    val totals = mutableMapOf<String, Stint>()
    history.forEachIndexed { index, entry ->
      val end = if (index + 1 < history.size) history[index + 1].enteredAt else now
      val previous = totals[entry.name]
      if (previous == null) order += entry.name
      totals[entry.name] = Stint(entry.name, previous?.type ?: entry.type, (previous?.duration ?: 0.0) + maxOf(0.0, end - entry.enteredAt))
    }
    return order.mapNotNull { totals[it] }
  }

  private val units = listOf(
    365 * 86_400_000.0 to "y", 30 * 86_400_000.0 to "mo", 7 * 86_400_000.0 to "w",
    86_400_000.0 to "d", 3_600_000.0 to "h", 60_000.0 to "m",
  )

  /** "10mo", "5d": Linear's short durations. */
  fun shortDuration(ms: Double): String {
    for ((size, unit) in units) if (ms >= size) return "${(ms / size).toInt()}$unit"
    return "<1m"
  }

  /** The most recent change to that property; null when it hasn't moved since the issue was created. */
  fun lastChange(kind: Kind, history: List<LinearHistoryEvent>?): LinearHistoryEvent? =
    history.orEmpty().filter { it.kind == kind.historyKind }.maxByOrNull { it.createdAt }
}

/** An open property menu: what's typed, what's highlighted, and what it picks. */
class LinearPropertyMenu(val options: List<LinearIssueProperty.Option>) {
  private val _query = MutableStateFlow("")
  val query: StateFlow<String> = _query.asStateFlow()
  private val _highlighted = MutableStateFlow<String?>(null)
  val highlighted: StateFlow<String?> = _highlighted.asStateFlow()

  fun setQuery(value: String) {
    _query.value = value
    _highlighted.value = null
  }

  fun highlight(id: String?) { _highlighted.value = id }

  /** The options whose title contains what's typed. */
  val visible: List<LinearIssueProperty.Option>
    get() {
      val query = _query.value.trim()
      if (query.isEmpty()) return options
      return options.filter { it.title.contains(query, ignoreCase = true) }
    }

  fun move(step: Int) {
    val rows = visible
    if (rows.isEmpty()) return
    val at = rows.indexOfFirst { it.id == _highlighted.value }
    if (at < 0) {
      _highlighted.value = (if (step > 0) rows.first() else rows.last()).id
      return
    }
    _highlighted.value = rows[(at + step + rows.size) % rows.size].id
  }

  /** Return: the highlighted row, else the top match. */
  val submission: LinearIssueProperty.Option?
    get() {
      val rows = visible
      return rows.firstOrNull { it.id == _highlighted.value } ?: rows.firstOrNull()
    }

  /** A digit's option, whether or not the filter shows it. */
  fun option(key: Char): LinearIssueProperty.Option? = options.firstOrNull { it.key == key }
}
