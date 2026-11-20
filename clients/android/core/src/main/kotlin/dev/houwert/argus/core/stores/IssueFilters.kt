package dev.houwert.argus.core.stores

import dev.houwert.argus.core.stores.IssueFilter.Field
import dev.houwert.argus.kit.protocol.generated.LinearIssue
import dev.houwert.argus.kit.protocol.generated.LinearWorkflowState
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeParseException
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * A Linear-style filter on the issues Argus already fetched: a field, "is" or "is not", and the
 * values it matches. Same values, labels and order as the desktop's `app/lib/issueFilters.ts`,
 * so every client persists the same thing.
 */
@Serializable
data class IssueFilter(
  val field: Field,
  /** "is not" / "doesn't contain". */
  val negate: Boolean = false,
  /** Option values; for `content`, the text to look for. */
  val values: List<String>,
) {
  @Serializable
  enum class Field(val label: String) {
    @SerialName("team") Team("Team"),
    @SerialName("status") Status("Status"),
    @SerialName("statusType") StatusType("Status type"),
    @SerialName("assignee") Assignee("Assignee"),
    @SerialName("creator") Creator("Creator"),
    @SerialName("priority") Priority("Priority"),
    @SerialName("estimate") Estimate("Estimate"),
    @SerialName("labels") Labels("Labels"),
    @SerialName("relations") Relations("Relations"),
    @SerialName("due") Due("Due date"),
    @SerialName("created") Created("Created"),
    @SerialName("updated") Updated("Updated"),
    @SerialName("project") Project("Project"),
    @SerialName("cycle") Cycle("Cycle"),
    @SerialName("links") Links("Links"),
    @SerialName("content") Content("Content");

    /** Takes free text instead of picking from options. */
    val isText: Boolean get() = this == Content
  }

  data class Option(val value: String, val label: String, val count: Int) {
    val id: String get() = value
  }

  fun negating(): IssueFilter = copy(negate = !negate)
}

object IssueFilters {
  /** The value for "no assignee", "no labels" and so on. */
  const val NONE = "__none__"

  /** The current-cycle filter the Mac's old Current cycle toggle became. */
  val currentCycle = IssueFilter(Field.Cycle, values = listOf("current"))

  /** Fields in the order the Filter menu lists them, grouped like Linear's. */
  val groups: List<List<Field>> = listOf(
    listOf(
      Field.Team, Field.Status, Field.StatusType, Field.Assignee, Field.Creator, Field.Priority, Field.Estimate,
      Field.Labels, Field.Relations, Field.Due, Field.Created, Field.Updated,
    ),
    listOf(Field.Project, Field.Cycle),
    listOf(Field.Links, Field.Content),
  )

  private const val DAY = 24.0 * 60 * 60 * 1000

  private val statusTypeNames = mapOf(
    "triage" to "Triage", "backlog" to "Backlog", "unstarted" to "Unstarted", "started" to "Started",
    "completed" to "Completed", "canceled" to "Canceled", "duplicate" to "Duplicate",
  )

  private val recency = listOf(
    "1d" to "In the last day", "7d" to "In the last week", "30d" to "In the last month", "90d" to "In the last 3 months",
  )

  /** Options offered before (or instead of) the ones seen in the data. */
  private fun fixed(field: Field): List<Pair<String, String>> = when (field) {
    Field.Priority -> LinearIssueBoard.priorityOrder.map { "$it" to LinearIssueBoard.priorityLabel(it) }
    Field.Relations -> listOf("sub" to "Is a sub-issue", "top" to "Isn't a sub-issue")
    Field.Created, Field.Updated -> recency
    Field.Due -> listOf("overdue" to "Overdue", "week" to "Due in the next week", "later" to "Due later")
    Field.Cycle -> listOf("current" to "Current cycle")
    Field.Links -> listOf("pr" to "Has a pull request", "no-pr" to "No pull request")
    else -> emptyList()
  }

  /** Only the fixed options: the data adds none. */
  private fun fixedOnly(field: Field) = field in setOf(Field.Priority, Field.Relations, Field.Created, Field.Updated, Field.Links)

  private fun labelOf(field: Field, value: String): String? = when (field) {
    Field.StatusType -> statusTypeNames[value] ?: value
    Field.Estimate -> "$value pt"
    else -> null
  }

  private fun recency(epochMs: Double, now: Double): List<String> {
    val age = now - epochMs
    return listOf(1.0 to "1d", 7.0 to "7d", 30.0 to "30d", 90.0 to "90d").mapNotNull { (days, value) -> value.takeIf { age <= days * DAY } }
  }

  private fun dueBuckets(due: String?, now: Double): List<String> {
    if (due.isNullOrEmpty()) return listOf(NONE)
    val at = try {
      LocalDateTime.parse("${due}T23:59:59").atZone(ZoneId.systemDefault()).toInstant().toEpochMilli().toDouble()
    } catch (_: DateTimeParseException) {
      return listOf("later")
    }
    if (at < now) return listOf("overdue")
    return if (at - now <= 7 * DAY) listOf("week") else listOf("later")
  }

  /** An issue's values for a field; plural fields match when any is picked. */
  internal fun values(field: Field, issue: LinearIssue, now: Double): List<String> = when (field) {
    Field.Team -> listOf(issue.teamName)
    Field.Status -> listOf(issue.state.name)
    Field.StatusType -> listOf(issue.state.type)
    Field.Assignee -> listOf(issue.assignee ?: NONE)
    Field.Creator -> listOf(issue.creator ?: NONE)
    Field.Priority -> listOf(LinearIssueBoard.number(issue.priority))
    Field.Estimate -> listOf(issue.estimate?.let(LinearIssueBoard::number) ?: NONE)
    Field.Labels -> issue.labels.ifEmpty { listOf(NONE) }
    Field.Relations -> listOf(if (issue.parent == null) "top" else "sub")
    Field.Created -> recency(issue.createdAt, now)
    Field.Updated -> recency(issue.updatedAt, now)
    Field.Due -> dueBuckets(issue.dueDate, now)
    Field.Project -> listOf(issue.project?.name ?: NONE)
    Field.Cycle -> (if (issue.cycle?.isActive == true) listOf("current") else emptyList()) + (LinearIssueBoard.cycleLabel(issue) ?: NONE)
    Field.Links -> listOf(if (issue.pullRequestCount > 0) "pr" else "no-pr")
    Field.Content -> emptyList()
  }

  /** The options a field offers for these issues, with how many match each. */
  fun options(
    field: Field,
    issues: List<LinearIssue>,
    states: List<LinearWorkflowState> = emptyList(),
    nowMillis: Double = System.currentTimeMillis().toDouble(),
  ): List<IssueFilter.Option> {
    if (field == Field.Status) return statusOptions(issues, states)
    val counts = mutableMapOf<String, Int>()
    for (issue in issues) {
      for (value in values(field, issue, nowMillis).toSet()) counts[value] = (counts[value] ?: 0) + 1
    }
    val fixed = fixed(field)
    val fixedValues = fixed.map { it.first }.toSet()
    val seen =
      if (fixedOnly(field)) emptyList()
      else counts.keys.filter { it != NONE && it !in fixedValues }.sortedWith(NaturalOrder).map { it to (labelOf(field, it) ?: it) }
    val empty = if (!fixedOnly(field) && NONE in counts) listOf(NONE to noneLabel(field)) else emptyList()
    return (fixed + seen + empty).map { (value, label) -> IssueFilter.Option(value, label, counts[value] ?: 0) }
  }

  /** Every status in workflow order: the teams' unused states count zero, so the menu tucks them away. */
  private fun statusOptions(issues: List<LinearIssue>, states: List<LinearWorkflowState>) =
    LinearIssueBoard.columns(issues, states).map { IssueFilter.Option(it.name, it.name, it.issues.size) }

  fun optionLabel(field: Field, value: String): String {
    if (value == NONE) return noneLabel(field)
    return fixed(field).firstOrNull { it.first == value }?.second ?: labelOf(field, value) ?: value
  }

  private fun noneLabel(field: Field) = "No ${field.label.lowercase()}"

  internal fun matches(issue: LinearIssue, filter: IssueFilter, now: Double): Boolean {
    if (filter.values.isEmpty()) return true
    val hit =
      if (filter.field == Field.Content) {
        val haystack = "${issue.identifier} ${issue.title} ${issue.description}".lowercase()
        filter.values.all { haystack.contains(it.lowercase()) }
      } else {
        val values = values(filter.field, issue, now)
        filter.values.any { it in values }
      }
    return if (filter.negate) !hit else hit
  }

  /** Issues every filter matches. */
  fun apply(issues: List<LinearIssue>, filters: List<IssueFilter>, nowMillis: Double = System.currentTimeMillis().toDouble()): List<LinearIssue> {
    if (filters.isEmpty()) return issues
    return issues.filter { issue -> filters.all { matches(issue, it, nowMillis) } }
  }

  // The filter row

  /** "is" / "is not", or "contains" / "doesn't contain" for text. */
  fun operatorLabel(filter: IssueFilter): String {
    if (filter.field.isText) return if (filter.negate) "doesn't contain" else "contains"
    return if (filter.negate) "is not" else "is"
  }

  /** The chip's values: up to two by name, then a count. */
  fun summary(filter: IssueFilter): String {
    if (filter.field.isText) return filter.values.joinToString(" ")
    val labels = filter.values.map { optionLabel(filter.field, it) }
    return if (labels.size > 2) "${labels.size} ${filter.field.label.lowercase()}" else labels.joinToString(", ")
  }

  /**
   * `filters` with one field's filter changed; a filter left with no values goes. A changed
   * filter keeps its place in the row, a new one goes last.
   */
  fun updating(filters: List<IssueFilter>, field: Field, change: (IssueFilter) -> IssueFilter?): List<IssueFilter> {
    val current = filters.firstOrNull { it.field == field } ?: IssueFilter(field, values = emptyList())
    val rest = filters.filter { it.field != field }
    val next = change(current)
    if (next == null || next.values.isEmpty()) return rest
    return if (filters.any { it.field == field }) filters.map { if (it.field == field) next else it } else rest + next
  }

  /** Ticks or unticks one option. */
  fun toggling(filters: List<IssueFilter>, field: Field, value: String): List<IssueFilter> =
    updating(filters, field) { filter ->
      filter.copy(values = if (value in filter.values) filter.values - value else filter.values + value)
    }

  /** Finder's order: case-insensitive, with runs of digits compared as numbers. */
  internal object NaturalOrder : Comparator<String> {
    private val chunks = Regex("\\d+|\\D+")

    override fun compare(a: String, b: String): Int {
      val left = chunks.findAll(a.lowercase()).map { it.value }.toList()
      val right = chunks.findAll(b.lowercase()).map { it.value }.toList()
      for (i in 0 until minOf(left.size, right.size)) {
        val (x, y) = left[i] to right[i]
        val result =
          if (x[0].isDigit() && y[0].isDigit()) x.toBigInteger().compareTo(y.toBigInteger()) else x.compareTo(y)
        if (result != 0) return result
      }
      return left.size.compareTo(right.size)
    }
  }
}
