package dev.houwert.argus.core.sessions

import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusAwaiting
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteSessionKind
import dev.houwert.argus.kit.protocol.generated.SessionPullRequestState
import dev.houwert.argus.kit.protocol.generated.SessionWorkflowStatus
import java.time.DayOfWeek
import java.time.Instant
import java.time.ZoneOffset
import java.time.ZonedDateTime
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val NOW = 1_700_000_000_000L
private val requiresAction = RemoteAgentStatusStatus.requiresAction

private fun agentIn(session: String, status: RemoteAgentStatusStatus = RemoteAgentStatusStatus.idle, awaiting: RemoteAgentStatusAwaiting? = null) =
  agent("a-$session", session = session, status = status, created = null, awaiting = awaiting)

class SessionTriageTest {
  @Test
  fun sortsNeedsYouWorkingIdleAndFoldsTheRest() {
    val sessions = listOf(
      session("idle"),
      session("merged", pullRequest = SessionPullRequestState.merged),
      session("running"),
      session("asking"),
      session("unread", unread = true),
      session("snoozed", snoozedUntil = (NOW + 60_000).toDouble()),
      session("watched", pullRequest = SessionPullRequestState.open, pullRequestWatched = true),
      session("rerunning", unread = true),
    )
    val agents: Map<String, List<RemoteAgentStatus>> = mapOf(
      "running" to listOf(agentIn("running", RemoteAgentStatusStatus.running)),
      "rerunning" to listOf(agentIn("rerunning", RemoteAgentStatusStatus.running)),
      "asking" to listOf(agentIn("asking", requiresAction, RemoteAgentStatusAwaiting.question)),
    )
    val triage = SessionTriage(sessions, NOW) { agents[it.id].orEmpty() }

    assertEquals(listOf("asking", "unread"), triage.needsYou.map { it.id })
    assertEquals(listOf("running", "watched", "rerunning", "idle"), triage.active.map { it.id })
    assertEquals(listOf("merged"), triage.done.map { it.id })
    assertEquals(listOf("snoozed"), triage.snoozed.map { it.id })
  }

  @Test
  fun aCompareRunSortsAsItsMostUrgentSlot() {
    val asking = listOf(
      session("x", compare = "g" to 0L),
      session("y", compare = "g" to 1L, pullRequest = SessionPullRequestState.merged),
      session("z", compare = "g" to 2L),
      session("other"),
    )
    val triage = SessionTriage(asking, NOW) {
      if (it.id == "z") listOf(agentIn("z", requiresAction, RemoteAgentStatusAwaiting.plan)) else emptyList()
    }
    assertEquals(listOf("x", "y", "z"), triage.needsYou.map { it.id })
    assertEquals(listOf("other"), triage.active.map { it.id })

    val settled = listOf(
      session("x", compare = "g" to 0L, pullRequest = SessionPullRequestState.merged),
      session("y", compare = "g" to 1L, settled = true),
    )
    assertEquals(listOf("x", "y"), SessionTriage(settled, NOW) { emptyList() }.done.map { it.id })
  }

  @Test
  fun aManualMarkBeatsThePullRequest() {
    assertFalse(session("a", pullRequest = SessionPullRequestState.merged, settled = false).isDone)
    assertTrue(session("b", pullRequest = SessionPullRequestState.open, settled = true).isDone)
    assertTrue(session("c", pullRequest = SessionPullRequestState.closed).isDone)
  }

  @Test
  fun aSetStatusBeatsThePullRequestAndAnOlderSettle() {
    val review = session("a", pullRequest = SessionPullRequestState.merged, workflowStatus = SessionWorkflowStatus.inReview, settled = false)
    assertEquals(SessionWorkflowStatus.inReview, review.effectiveStatus)
    assertFalse(review.isDone)
    assertTrue(session("b", workflowStatus = SessionWorkflowStatus.done, settled = true).isDone)
    assertEquals(SessionWorkflowStatus.inReview, session("c", pullRequest = SessionPullRequestState.open).effectiveStatus)
    assertEquals(SessionWorkflowStatus.inProgress, session("d", settled = false).effectiveStatus)
    assertEquals(null, session("e", workflowStatus = SessionWorkflowStatus("someday")).effectiveStatus)
    assertEquals(null, session("f").effectiveStatus)
  }

  @Test
  fun anArchivedSessionLeavesEveryList() {
    val triage = SessionTriage(listOf(session("a", unread = true, archivedAt = 1000.0), session("b")), NOW) { emptyList() }
    assertEquals(listOf("b"), (triage.needsYou + triage.active + triage.folded).map { it.id })
    assertEquals(listOf("a"), archivedSessions(listOf(session("a", archivedAt = 1000.0), session("b"))).map { it.id })
  }

  @Test
  fun needingYouOutranksASnoozeAndDone() {
    val s = session("s", settled = true, snoozedUntil = (NOW + 60_000).toDouble())
    val activity = SessionActivity(s, listOf(agentIn("s", requiresAction, RemoteAgentStatusAwaiting.permission)))
    assertEquals(SessionAttention.NeedsYou, activity.attention(NOW))
  }

  @Test
  fun aSnoozeInThePastIsOver() {
    val s = session("s", snoozedUntil = (NOW - 60_000).toDouble())
    assertEquals(SessionAttention.Idle, SessionActivity(s, emptyList()).attention(NOW))
  }

  @Test
  fun presetsLandInTheFuture() {
    // Tuesday 14 November 2023, 22:13 UTC.
    val late = ZonedDateTime.ofInstant(Instant.ofEpochMilli(NOW), ZoneOffset.UTC)
    assertNull(SnoozePreset.ThisEvening.date(late))
    val tomorrow = SnoozePreset.Tomorrow.date(late)!!
    assertEquals(9, tomorrow.hour)
    assertTrue(tomorrow.isAfter(late))
    val monday = SnoozePreset.NextWeek.date(late)!!
    assertEquals(DayOfWeek.MONDAY, monday.dayOfWeek)
    assertTrue(monday.isAfter(late))
    assertEquals(late.plusHours(1), SnoozePreset.OneHour.date(late))
  }

  @Test
  fun thisEveningNeedsHalfAnHourLeft() {
    val afternoon = ZonedDateTime.of(2023, 11, 14, 15, 0, 0, 0, ZoneOffset.UTC)
    assertEquals(afternoon.withHour(18), SnoozePreset.ThisEvening.date(afternoon))
    assertNull(SnoozePreset.ThisEvening.date(afternoon.withHour(17).withMinute(45)))
  }
}

class SessionGroupTriageTest {
  @Test
  fun keepsTheRootOnTopAndNeverFoldsIt() {
    val root = session("root", kind = RemoteSessionKind.projectRoot, settled = true)
    val merged = session("merged", pullRequest = SessionPullRequestState.merged)
    val busy = session("busy")
    val groups = listOf(root, merged, busy).map {
      SessionGroup(it.id, it.branch, it, if (it.id == "busy") listOf(agentIn("busy", RemoteAgentStatusStatus.running)) else emptyList())
    }
    val triage = SessionGroupTriage(groups, NOW)
    assertEquals(listOf("root", "busy"), triage.active.map { it.id })
    assertEquals(listOf("merged"), triage.done.map { it.id })
    assertEquals("1 done", triage.foldedLabel)
  }
}
