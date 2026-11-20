package dev.houwert.argus.core.stores

import dev.houwert.argus.core.stores.IssueFilter.Field
import dev.houwert.argus.kit.protocol.generated.LinearWorkflowState
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.Test

class IssueFilterMenuTest {
  private class Box { var filters = emptyList<IssueFilter>() }

  private val issues = listOf(
    linearIssue("A", state = "Todo", priority = 1.0, labels = listOf("Bug")),
    linearIssue("B", state = "Todo", priority = 2.0),
  )

  private fun menu(box: Box, field: Field? = null) =
    IssueFilterMenu(issues, field = field, read = { box.filters }, apply = { box.filters = it })

  @Test fun searchesFieldsAndOpensTheHighlightedOne() {
    val menu = menu(Box())
    menu.setFieldQuery("pri")
    assertEquals(listOf(Field.Priority), menu.fieldGroups.flatten())
    assertFalse(menu.submit())
    assertEquals(Field.Priority, menu.field.value)
  }

  @Test fun splitsOutOptionsNoIssueMatches() {
    val menu = menu(Box(), Field.Priority)
    assertEquals(listOf("1", "2"), menu.options.shown.map { it.value })
    assertEquals(listOf("3", "4", "0"), menu.options.unmatched.map { it.value })
    menu.showUnmatched()
    assertEquals(5, menu.options.shown.size)
    assertTrue(menu.options.unmatched.isEmpty())
  }

  @Test fun listsStatusesInWorkflowOrderWithUnusedOnesUnmatched() {
    val box = Box()
    val states = listOf(
      LinearWorkflowState("d", "Done", "completed", 0.0),
      LinearWorkflowState("s", "Todo", "unstarted", 1.0),
      LinearWorkflowState("b", "Backlog", "backlog", 0.0),
    )
    val menu = IssueFilterMenu(listOf(linearIssue("A", state = "Todo", priority = 1.0)), states, Field.Status, { box.filters }, { box.filters = it })
    assertEquals(listOf("Todo"), menu.options.shown.map { it.value })
    assertEquals(listOf("Backlog", "Done"), menu.options.unmatched.map { it.value })
  }

  @Test fun submitTicksTheHighlightedValueAndCloses() {
    val box = Box()
    val menu = menu(box, Field.Priority)
    menu.move(1)
    menu.move(1)
    assertTrue(menu.submit())
    assertEquals(listOf(IssueFilter(Field.Priority, values = listOf("2"))), box.filters)
  }

  @Test fun backGoesToTheFieldsOnlyWhenOpenedFromThem() {
    val box = Box()
    val fromFields = menu(box)
    fromFields.open(Field.Labels)
    assertTrue(fromFields.back())
    assertNull(fromFields.field.value)
    assertFalse(menu(box, Field.Labels).back())
  }

  @Test fun textFieldsFilterOnWhatsTyped() {
    val box = Box()
    val menu = menu(box, Field.Content)
    menu.setValueQuery("crash")
    assertTrue(menu.submit())
    assertEquals(listOf(IssueFilter(Field.Content, values = listOf("crash"))), box.filters)
  }
}
