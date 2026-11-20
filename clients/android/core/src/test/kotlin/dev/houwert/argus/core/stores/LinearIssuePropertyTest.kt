package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.LinearHistoryEvent
import dev.houwert.argus.kit.protocol.generated.LinearHistoryEventKind
import dev.houwert.argus.kit.protocol.generated.LinearIssueDetailStatusHistoryItem
import dev.houwert.argus.kit.protocol.generated.LinearWorkflowState
import kotlin.test.assertEquals
import kotlin.test.assertNull
import org.junit.Test

class LinearIssuePropertyTest {
  private val day = 86_400_000.0

  private fun entry(name: String, type: String, days: Double) = LinearIssueDetailStatusHistoryItem(name, type, days * day)

  @Test fun sumsEachStatusesTimeIncludingReturnsToIt() {
    val stints = LinearIssueProperty.timeInStatus(
      listOf(
        entry("Triage", "triage", 0.0), entry("Todo", "unstarted", 5.0),
        entry("In Progress", "started", 7.0), entry("Todo", "unstarted", 8.0),
      ),
      now = 10 * day,
    )
    assertEquals(listOf("Triage", "Todo", "In Progress"), stints.map { it.name })
    assertEquals(listOf(5.0, 4.0, 1.0), stints.map { it.duration / day })
  }

  @Test fun usesLinearsShortUnits() {
    assertEquals("5d", LinearIssueProperty.shortDuration(5 * day))
    assertEquals("10mo", LinearIssueProperty.shortDuration(300 * day))
    assertEquals("<1m", LinearIssueProperty.shortDuration(30_000.0))
  }

  @Test fun statusesAreKeyedOneToNineThenZeroThenNotAtAll() {
    val states = (0 until 12).map { LinearWorkflowState("s$it", "S$it", "unstarted", it.toDouble()) }
    assertEquals(listOf('1', '2', '3', '4', '5', '6', '7', '8', '9', '0', null, null), LinearIssueProperty.statusOptions(states).map { it.key })
  }

  @Test fun statusesFollowTheWorkflowNotTheTeamsRawOrder() {
    val states = listOf(
      Triple("Done", "completed", 1.0), Triple("Ready for QA", "completed", 0.0), Triple("In Review", "started", 3.0),
      Triple("Todo", "unstarted", 0.0), Triple("Backlog", "backlog", 0.0), Triple("Triage", "triage", 0.0),
    ).map { LinearWorkflowState(it.first, it.first, it.second, it.third) }
    assertEquals(
      listOf("Triage", "Backlog", "Todo", "In Review", "Ready for QA", "Done"),
      LinearIssueProperty.statusOptions(states).map { it.title },
    )
  }

  @Test fun prioritiesRunUrgentToLowThenNoneKeyedByTheirNumber() {
    val options = LinearIssueProperty.priorityOptions
    assertEquals(listOf("Urgent", "High", "Medium", "Low", "No priority"), options.map { it.title })
    assertEquals(listOf('1', '2', '3', '4', '0'), options.map { it.key })
  }

  @Test fun theLastChangeOfAKindIsTheNewestOne() {
    val history = listOf(
      LinearHistoryEvent("a", 1.0, "ann", kind = LinearHistoryEventKind.priority, text = "set priority"),
      LinearHistoryEvent("b", 3.0, "bob", kind = LinearHistoryEventKind.priority, text = "set priority"),
      LinearHistoryEvent("c", 5.0, "cy", kind = LinearHistoryEventKind.status, text = "moved"),
    )
    assertEquals("b", LinearIssueProperty.lastChange(LinearIssueProperty.Kind.Priority, history)?.id)
    assertNull(LinearIssueProperty.lastChange(LinearIssueProperty.Kind.Assignee, history))
    assertNull(LinearIssueProperty.lastChange(LinearIssueProperty.Kind.Cycle, null))
  }

  @Test fun typingFiltersStepsWrapAndSubmitTakesTheHighlightOrTheTopMatch() {
    val menu = LinearPropertyMenu(LinearIssueProperty.priorityOptions)
    menu.setQuery("ur")
    assertEquals(listOf("Urgent"), menu.visible.map { it.title })
    assertEquals("1", menu.submission?.id)
    menu.setQuery("")
    menu.move(-1)
    assertEquals("0", menu.highlighted.value)
    menu.move(1)
    assertEquals("1", menu.highlighted.value)
    assertEquals("1", menu.submission?.id)
    menu.setQuery("zzz")
    assertNull(menu.submission)
    assertEquals("Medium", menu.option('3')?.title)
  }
}
