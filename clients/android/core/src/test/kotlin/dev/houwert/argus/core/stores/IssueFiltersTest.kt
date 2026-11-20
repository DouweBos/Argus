package dev.houwert.argus.core.stores

import dev.houwert.argus.core.stores.IssueFilter.Field
import dev.houwert.argus.kit.protocol.generated.LinearIssueCycle
import dev.houwert.argus.kit.storage.InMemoryKeyValueStore
import dev.houwert.argus.kit.storage.Preferences
import kotlin.test.assertEquals
import org.junit.Test

/** Mirrors `app/lib/issueFilters.test.ts`: every client has to agree. */
class IssueFiltersTest {
  private val now = 1_793_275_200_000.0 // 2026-10-29T12:00:00Z
  private val day = 24.0 * 60 * 60 * 1000

  private val issues = listOf(
    linearIssue("A", title = "Fix login", priority = 1.0, labels = listOf("Bug", "iOS"), cycle = LinearIssueCycle("c", 59.0, isActive = true), createdAt = now, updatedAt = now),
    linearIssue("B", title = "Fix login", priority = 2.0, labels = listOf("Bug"), cycle = LinearIssueCycle("d", 58.0, isActive = false), createdAt = now, updatedAt = now),
    linearIssue("C", title = "Casting crash", priority = 2.0, createdAt = now - 40 * day, updatedAt = now),
  )

  private fun ids(filters: List<IssueFilter>) = IssueFilters.apply(issues, filters, now).map { it.identifier }

  @Test fun matchesAnyValueWithinAFilterAndEveryFilter() {
    assertEquals(listOf("A", "B", "C"), ids(listOf(IssueFilter(Field.Priority, values = listOf("1", "2")))))
    assertEquals(listOf("B"), ids(listOf(IssueFilter(Field.Priority, values = listOf("2")), IssueFilter(Field.Labels, values = listOf("Bug")))))
    assertEquals(listOf("C"), ids(listOf(IssueFilter(Field.Labels, negate = true, values = listOf("Bug")))))
    assertEquals(listOf("A"), ids(listOf(IssueFilters.currentCycle)))
    assertEquals(listOf("C"), ids(listOf(IssueFilter(Field.Content, values = listOf("casting")))))
    assertEquals(listOf("A", "B"), ids(listOf(IssueFilter(Field.Created, values = listOf("30d")))))
  }

  @Test fun countsEachOptionAndListsFixedOnesFirst() {
    val cycle = IssueFilters.options(Field.Cycle, issues, nowMillis = now)
    assertEquals(listOf("Current cycle", "Cycle 58", "Cycle 59", "No cycle"), cycle.map { it.label })
    assertEquals(listOf(1, 1, 1, 1), cycle.map { it.count })
    assertEquals(listOf(1, 2, 0, 0, 0), IssueFilters.options(Field.Priority, issues, nowMillis = now).map { it.count })
  }

  @Test fun namesTheEmptyOptionAfterTheField() {
    assertEquals("No labels", IssueFilters.optionLabel(Field.Labels, "__none__"))
  }

  @Test fun summarisesAChip() {
    assertEquals("Urgent, High", IssueFilters.summary(IssueFilter(Field.Priority, values = listOf("1", "2"))))
    assertEquals("3 labels", IssueFilters.summary(IssueFilter(Field.Labels, values = listOf("a", "b", "c"))))
    assertEquals("doesn't contain", IssueFilters.operatorLabel(IssueFilter(Field.Content, negate = true, values = listOf("x"))))
  }

  @Test fun keepsAChangedFilterInPlaceAndDropsAnEmptyOne() {
    var filters = IssueFilters.toggling(emptyList(), Field.Priority, "1")
    filters = IssueFilters.toggling(filters, Field.Labels, "Bug")
    filters = IssueFilters.toggling(filters, Field.Priority, "2")
    assertEquals(listOf(Field.Priority, Field.Labels), filters.map { it.field })
    assertEquals(listOf("1", "2"), filters[0].values)
    filters = IssueFilters.toggling(filters, Field.Labels, "Bug")
    assertEquals(listOf(Field.Priority), filters.map { it.field })
  }

  @Test fun persistsInTheSameShapeAsTheOtherClients() {
    val preferences = Preferences(InMemoryKeyValueStore())
    LinearIssuesModel.save(mapOf("assigned" to listOf(IssueFilters.currentCycle)), preferences)

    assertEquals("""{"assigned":[{"field":"cycle","negate":false,"values":["current"]}]}""", preferences.string(LinearIssuesModel.FILTERS_KEY))
    assertEquals(mapOf("assigned" to listOf(IssueFilters.currentCycle)), LinearIssuesModel.load(preferences))
  }
}
