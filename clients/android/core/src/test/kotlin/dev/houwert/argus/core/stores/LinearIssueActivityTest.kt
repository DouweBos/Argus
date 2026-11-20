package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.LinearComment
import dev.houwert.argus.kit.protocol.generated.LinearHistoryEvent
import dev.houwert.argus.kit.protocol.generated.LinearHistoryEventKind
import dev.houwert.argus.kit.protocol.generated.LinearIssueDetailRelationsItem
import dev.houwert.argus.kit.protocol.generated.LinearIssueDetailRelationsItemState
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.Test

class LinearIssueActivityTest {
  private fun comment(id: String, parent: String? = null, at: Double) =
    LinearComment(id = id, parentId = parent, author = "ann", body = id, createdAt = at)

  private fun event(id: String, kind: LinearHistoryEventKind = LinearHistoryEventKind.status, at: Double) =
    LinearHistoryEvent(id = id, createdAt = at, actor = null, kind = kind, text = "did $id")

  @Test fun repliesHangOffTheirThreadsFirstCommentNestedRepliesToo() {
    val threads = LinearIssueActivity.threads(
      listOf(
        comment("r2", "r1", 3.0), comment("a", at = 1.0), comment("r1", "a", 2.0),
        comment("b", at = 4.0), comment("orphan", "gone", 5.0),
      )
    )
    assertEquals(listOf("a", "b", "orphan"), threads.map { it.root.id })
    assertEquals(listOf("r1", "r2"), threads[0].replies.map { it.id })
    assertTrue(threads[1].replies.isEmpty())
  }

  @Test fun eventsAndThreadsInterleaveByTimeLongRunsFoldTheirMiddle() {
    val history = (1..6).map { event("e$it", at = it.toDouble()) } + event("late", at = 20.0)
    val items = LinearIssueActivity.timeline(history, listOf(comment("c", at = 10.0)))
    assertEquals(listOf("e-e1", "f-e2", "e-e5", "e-e6", "t-c", "e-late"), items.map { it.id })
    assertEquals(listOf("e2", "e3", "e4"), (items[1] as LinearIssueActivity.Item.Folded).events.map { it.id })
  }

  @Test fun shortRunsStayAsTheyAre() {
    val items = LinearIssueActivity.timeline((1..4).map { event("e$it", at = it.toDouble()) }, emptyList())
    assertEquals(4, items.size)
  }

  @Test fun aFoldedRunNamesWhatChangedOnceEach() {
    val events = listOf(
      event("1", LinearHistoryEventKind.status, 1.0), event("2", LinearHistoryEventKind.assignee, 2.0),
      event("3", LinearHistoryEventKind.status, 3.0), event("4", LinearHistoryEventKind.cycle, 4.0),
    )
    assertEquals("Show 4 events: changed status, assignee, and cycles", LinearIssueActivity.foldedSummary(events))
    assertEquals(
      "Show 2 events",
      LinearIssueActivity.foldedSummary(listOf(event("1", LinearHistoryEventKind.other, 1.0), event("2", LinearHistoryEventKind.created, 2.0))),
    )
  }

  @Test fun linearItselfSpeaksWhenTheresNoActor() {
    assertEquals("Linear did x", LinearIssueActivity.sentence(event("x", at = 1.0)))
  }

  @Test fun relationsGroupBlockersFirst() {
    val state = LinearIssueDetailRelationsItemState("Todo", "unstarted")
    val groups = LinearIssueActivity.relationGroups(
      listOf(LinearIssueDetailRelationsItem("related", "A-1", "a", state), LinearIssueDetailRelationsItem("blocked_by", "A-2", "b", state))
    )
    assertEquals(listOf("Blocked by", "Related"), groups.map { it.title })
  }

  @Test fun anIssuesPlaceInTheListAndItsNeighbours() {
    val order = listOf("A-1", "A-2", "A-3")
    assertNull(LinearIssueActivity.position("A-1", order)?.previous)
    assertEquals(LinearIssueActivity.Position(1, 3, "A-1", "A-3"), LinearIssueActivity.position("A-2", order))
    assertNull(LinearIssueActivity.position("B-1", order))
  }

  @Test fun tShirtTeamsSizeEveryoneElseCountsPoints() {
    assertEquals("M", LinearIssueBoard.estimateLabel(3.0, type = "tShirt"))
    assertEquals("3 pt", LinearIssueBoard.estimateLabel(3.0, type = "fibonacci"))
    assertEquals("4 pt", LinearIssueBoard.estimateLabel(4.0, type = "tShirt"))
  }
}
