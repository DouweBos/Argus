package dev.houwert.argus.core.stores

import dev.houwert.argus.core.support.decode
import dev.houwert.argus.kit.protocol.generated.LinearWorkflowState
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.Test

class LinearIssueBoardTest {
  private fun session(json: String) = decode(RemoteSession.serializer(), json)

  @Test fun columnsFollowTheWorkflow() {
    val columns = LinearIssueBoard.columns(
      listOf(
        linearIssue("ENG-1", type = "started", state = "In Review", position = 3.0),
        linearIssue("ENG-2", type = "backlog"),
        linearIssue("ENG-3", type = "started", state = "In Progress", position = 2.0),
        linearIssue("ENG-4", type = "completed", state = "Done"),
        linearIssue("ENG-5", type = "triage"),
      )
    )
    assertEquals(listOf("triage", "backlog", "In Progress", "In Review", "Done"), columns.map { it.name })
  }

  @Test fun sameNamedStatesShareAColumn() {
    val columns = LinearIssueBoard.columns(
      listOf(linearIssue("ENG-1", type = "started", state = "In Progress"), linearIssue("APP-2", type = "started", state = "in progress"))
    )
    assertEquals(1, columns.size)
    assertEquals(listOf("ENG-1", "APP-2"), columns[0].issues.map { it.identifier })
  }

  @Test fun lanesSkipEmptyPrioritiesAndPutNoneLast() {
    val issues = listOf(
      linearIssue("ENG-1", type = "started", priority = 0.0), linearIssue("ENG-2", type = "started", priority = 3.0),
      linearIssue("ENG-3", type = "backlog", priority = 1.0), linearIssue("ENG-4", type = "backlog", priority = 3.0),
    )
    val lanes = LinearIssueBoard.lanes(issues)
    assertEquals(listOf(1, 3, 0), lanes.map { it.priority })
    assertEquals(listOf(1, 2, 1), lanes.map { it.count })
    assertEquals(listOf("Urgent", "Medium", "No priority"), lanes.map { it.title })
  }

  @Test fun cellsHoldTheirLaneNewestFirst() {
    val issues = listOf(
      linearIssue("ENG-1", type = "started", priority = 2.0, updatedAt = 1.0),
      linearIssue("ENG-2", type = "started", priority = 2.0, updatedAt = 5.0),
      linearIssue("ENG-3", type = "started", priority = 4.0),
    )
    val column = LinearIssueBoard.columns(issues).first()
    val high = LinearIssueBoard.lanes(issues).first()
    assertEquals(listOf("ENG-2", "ENG-1"), LinearIssueBoard.cell(column, high).map { it.identifier })
  }

  @Test fun labelsCyclesAndEstimates() {
    assertEquals("Cycle 59", LinearIssueBoard.cycleLabel(59.0, null))
    assertEquals("Sprint 4", LinearIssueBoard.cycleLabel(59.0, "Sprint 4"))
    assertEquals("59", LinearIssueBoard.cycleShortLabel(24.0, "Cycle 59"))
    assertEquals("3 pt", LinearIssueBoard.estimateLabel(3.0))
    assertEquals("0.5 pt", LinearIssueBoard.estimateLabel(0.5))
    assertEquals("3", LinearIssueBoard.estimateLabel(3.0, unit = false))
  }

  @Test fun namesPriorities() {
    assertEquals("Urgent", LinearIssueBoard.priority(1.0))
    assertEquals("Low", LinearIssueBoard.priority(4.0))
    assertNull(LinearIssueBoard.priority(0.0))
    assertTrue(LinearIssueBoard.isPressing(2.0))
    assertFalse(LinearIssueBoard.isPressing(3.0))
  }

  @Test fun findsTheSessionOnAnIssue() {
    val linked = session(
      """{"id":"a","repo_root":"/r","kind":"worktree","branch":"other","status":"ready","linked_issue":{"source":"linear","identifier":"ENG-1","title":"t","url":"u"}}"""
    )
    val byBranch = session("""{"id":"b","repo_root":"/r","kind":"worktree","branch":"eng-2-fix","status":"ready"}""")
    val root = session("""{"id":"c","repo_root":"/r","kind":"project_root","branch":"eng-3-fix","status":"ready"}""")
    val sessions = listOf(linked, byBranch, root)

    assertEquals("a", LinearIssueBoard.session(linearIssue("ENG-1", type = "started"), sessions)?.id)
    assertEquals("b", LinearIssueBoard.session(linearIssue("ENG-2", type = "started"), sessions)?.id)
    // A checkout that happens to be on the branch isn't a session started for it.
    assertNull(LinearIssueBoard.session(linearIssue("ENG-3", type = "started"), sessions))
  }

  @Test fun hidesEmptyAndClosedColumnsUntilShown() {
    val columns = LinearIssueBoard.columns(
      listOf(linearIssue("ENG-1", type = "backlog"), linearIssue("ENG-2", type = "unstarted"), linearIssue("ENG-3", type = "duplicate")),
      states = listOf(LinearWorkflowState("s", "Blocked", "started", 9.0)),
    )
    fun hidden(overrides: Map<String, Boolean>) = columns.filter { LinearIssueBoard.isHidden(it, overrides) }.map { it.name }

    assertEquals(listOf("Blocked", "duplicate"), hidden(emptyMap()))
    assertEquals(listOf("unstarted", "duplicate"), hidden(mapOf("blocked" to false, "unstarted" to true)))
  }

  @Test fun workflowStatesAddEmptyColumnsMergedAcrossTeams() {
    val columns = LinearIssueBoard.columns(
      listOf(linearIssue("ENG-1", type = "started", state = "In Progress", position = 2.0)),
      states = listOf(
        LinearWorkflowState("a", "Done", "completed", 5.0),
        LinearWorkflowState("b", "In Progress", "started", 2.0),
        LinearWorkflowState("c", "in progress", "started", 2.0, color = "#f2c94c"),
        LinearWorkflowState("d", "Todo", "unstarted", 1.0, color = "#e2e2e2"),
      ),
    )
    assertEquals(listOf("Todo", "In Progress", "Done"), columns.map { it.name })
    assertEquals(listOf(0, 1, 0), columns.map { it.issues.size })
    assertEquals("#f2c94c", columns[1].color)
  }
}
