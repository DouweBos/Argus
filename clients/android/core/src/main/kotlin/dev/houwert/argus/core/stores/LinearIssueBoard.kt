package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.LinearIssue
import dev.houwert.argus.kit.protocol.generated.LinearIssueCycle
import dev.houwert.argus.kit.protocol.generated.LinearIssueDetail
import dev.houwert.argus.kit.protocol.generated.LinearIssueLabelColorsItem
import dev.houwert.argus.kit.protocol.generated.LinearIssueParent
import dev.houwert.argus.kit.protocol.generated.LinearIssueProject
import dev.houwert.argus.kit.protocol.generated.LinearIssueScope
import dev.houwert.argus.kit.protocol.generated.LinearWorkflowState
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionKind

/** Scopes in the order the Issues screen offers them. */
val LinearIssueScope.Companion.all: List<LinearIssueScope> get() = listOf(LinearIssueScope.assigned, LinearIssueScope.created, LinearIssueScope.subscribed)

val LinearIssueScope.title: String
  get() = when (this) {
    LinearIssueScope.created -> "Created"
    LinearIssueScope.subscribed -> "Subscribed"
    else -> "Assigned"
  }

/** What an empty list says for this scope. */
val LinearIssueScope.emptyText: String
  get() = when (this) {
    LinearIssueScope.created -> "Open issues you created in Linear show up here."
    LinearIssueScope.subscribed -> "Open issues you're subscribed to in Linear show up here."
    else -> "Open issues assigned to you in Linear show up here."
  }

/** The detail as the card and the board read it. */
fun LinearIssueDetail.summary(): LinearIssue = LinearIssue(
  id = id, identifier = identifier, title = title, description = description, url = url, branchName = branchName,
  state = state, priority = priority, estimate = estimate, estimateType = estimateType,
  labelColors = labelColors?.map { LinearIssueLabelColorsItem(it.name, it.color) },
  teamId = teamId, teamKey = teamKey, teamName = teamName, assignee = assignee, assigneeAvatarUrl = assigneeAvatarUrl,
  creator = creator, dueDate = dueDate, labels = labels,
  project = project?.let { LinearIssueProject(it.id, it.name) },
  cycle = cycle?.let { LinearIssueCycle(it.id, it.number, it.name, it.isActive) },
  parent = parent?.let { LinearIssueParent(it.identifier, it.title) },
  pullRequestCount = pullRequestCount, createdAt = createdAt, updatedAt = updatedAt,
)

/**
 * How the Issues screen lays Linear out: a column per workflow state, a lane per priority, and
 * which session is on an issue — the desktop's `app/lib/issueBoard.ts`.
 */
object LinearIssueBoard {
  data class Column(
    /** The state's name, lowercased: same-named states across teams share it. */
    val id: String,
    val name: String,
    /** Linear's category, for the column's glyph. */
    val type: String,
    /** Linear's own `#rrggbb` for the state, when it sent one. */
    val color: String?,
    /** Empty for a state of the team's workflow no issue is in. */
    val issues: List<LinearIssue>,
  )

  data class Lane(val priority: Int, val count: Int) {
    val id: Int get() = priority
    val title: String get() = priorityLabel(priority)
  }

  /** Linear's state categories in the order work flows through them. */
  internal val typeOrder = listOf("triage", "backlog", "unstarted", "started", "completed", "canceled", "duplicate")

  /** Done, canceled and duplicate stay hidden until shown, like Linear's "My issues". */
  internal val hiddenByDefault = setOf("canceled", "completed", "duplicate")

  /**
   * `overrides` maps a column id to an explicit hide (true) or show (false); otherwise a column
   * shows when it has issues and isn't a closed state.
   */
  fun isHidden(column: Column, overrides: Map<String, Boolean>): Boolean =
    overrides[column.id] ?: (column.issues.isEmpty() || column.type in hiddenByDefault)

  /** Urgent first, "no priority" last — Linear's own order. */
  val priorityOrder = listOf(1, 2, 3, 4, 0)

  /** One column per state the issues are in, plus every state in `states`, in workflow order. */
  fun columns(issues: List<LinearIssue>, states: List<LinearWorkflowState> = emptyList()): List<Column> {
    val order = mutableListOf<String>()
    val stateByKey = mutableMapOf<String, LinearWorkflowState>()
    val issuesByKey = mutableMapOf<String, MutableList<LinearIssue>>()
    fun add(state: LinearWorkflowState): String {
      val key = state.name.lowercase()
      val known = stateByKey[key]
      if (known == null) {
        order += key
        stateByKey[key] = state
        issuesByKey[key] = mutableListOf()
      } else if (known.color == null && state.color != null) {
        stateByKey[key] = known.copy(color = state.color)
      }
      return key
    }
    for (state in states) add(state)
    for (issue in issues) issuesByKey.getValue(add(issue.state)) += issue
    return order
      .map { Triple(it, stateByKey.getValue(it), issuesByKey.getValue(it).toList()) }
      .sortedWith(compareBy({ typeRank(it.second.type) }, { it.second.position }))
      .map { (key, state, list) -> Column(key, state.name, state.type, state.color, list) }
  }

  /** A lane per priority that has issues, most urgent first. */
  fun lanes(issues: List<LinearIssue>): List<Lane> = priorityOrder.mapNotNull { priority ->
    val count = issues.count { it.priority.toInt() == priority }
    if (count == 0) null else Lane(priority, count)
  }

  /** One board cell: the column's issues in the lane, most recent first. */
  fun cell(column: Column, lane: Lane): List<LinearIssue> =
    column.issues.filter { it.priority.toInt() == lane.priority }.sortedWith(byPriority)

  /** Most urgent first, then most recently touched. */
  val byPriority: Comparator<LinearIssue> =
    compareBy<LinearIssue> { priorityRank(it.priority) }.thenByDescending { it.updatedAt }

  fun priorityLabel(value: Int): String = when (value) {
    1 -> "Urgent"
    2 -> "High"
    3 -> "Medium"
    4 -> "Low"
    else -> "No priority"
  }

  /** Null for "No priority" (0) and anything Linear adds later. */
  fun priority(value: Double): String? = if (value.toInt() in 1..4) priorityLabel(value.toInt()) else null

  /** Urgent and High stand out. */
  fun isPressing(value: Double): Boolean = value.toInt() in 1..2

  /** "Sprint 4", or "Cycle 59" when the cycle has no name. */
  fun cycleLabel(number: Double, name: String?): String =
    if (!name.isNullOrEmpty()) name else "Cycle ${number.toInt()}"

  /** The card's short form: Linear names cycles "Cycle 59" while their `number` counts differently. */
  fun cycleShortLabel(number: Double, name: String?): String = cycleLabel(number, name).replace("Cycle ", "")

  fun cycleLabel(issue: LinearIssue): String? = issue.cycle?.let { cycleLabel(it.number, it.name) }

  /** Linear stores t-shirt sizes as these numbers — `estimateName` in `linearLabels.ts`. */
  private val tShirt = mapOf(
    0.0 to "None", 1.0 to "XS", 2.0 to "S", 3.0 to "M", 5.0 to "L", 8.0 to "XL", 13.0 to "XXL", 21.0 to "XXXL",
  )

  /** `M` on a t-shirt team, `3 pt` elsewhere; `unit` false drops the " pt" for a card with its own glyph. */
  fun estimateLabel(estimate: Double, type: String? = null, unit: Boolean = true): String {
    if (type == "tShirt") tShirt[estimate]?.let { return it }
    val points = number(estimate)
    return if (unit) "$points pt" else points
  }

  /** The order the list reads in: a status at a time, most urgent first. */
  fun listOrder(issues: List<LinearIssue>): List<LinearIssue> = columns(issues).flatMap { it.issues.sortedWith(byPriority) }

  /** The order the board reads in: lane by lane, left to right across `columns`. */
  fun boardOrder(columns: List<Column>): List<LinearIssue> =
    lanes(columns.flatMap { it.issues }).flatMap { lane -> columns.flatMap { cell(it, lane) } }

  /** Started from the issue, or a worktree on its Linear branch name. */
  fun session(issue: LinearIssue, sessions: Iterable<RemoteSession>): RemoteSession? =
    session(issue.identifier, issue.branchName, sessions)

  fun session(identifier: String, branchName: String, sessions: Iterable<RemoteSession>): RemoteSession? =
    sessions.firstOrNull { it.linkedIssue?.identifier == identifier || (it.kind == RemoteSessionKind.worktree && it.branch == branchName) }

  internal fun typeRank(type: String): Int = typeOrder.indexOf(type).let { if (it < 0) typeOrder.size else it }

  internal fun priorityRank(value: Double): Int = priorityOrder.indexOf(value.toInt()).let { if (it < 0) priorityOrder.size else it }

  /** JavaScript's `String(n)`: no trailing ".0". */
  internal fun number(value: Double): String =
    if (value == Math.rint(value) && kotlin.math.abs(value) < 1e15) value.toLong().toString() else value.toString()
}
