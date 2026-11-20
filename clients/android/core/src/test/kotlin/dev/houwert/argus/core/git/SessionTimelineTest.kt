package dev.houwert.argus.core.git

import kotlin.test.assertEquals
import org.junit.Test

class SessionTimelineTest {
  private val turns = listOf(
    TimelineTurn(1, "a", "x", prompt = "First", timestamp = 1.0, available = false),
    TimelineTurn(2, "b", "x", prompt = "Second", timestamp = 2.0),
    TimelineTurn(3, "c", "x", prompt = "Third", timestamp = 4.0, finished = false),
  )

  @Test fun listsNewestFirstWithRestoresBetweenTurns() {
    val restore = TimelineRestore("r", "b", 2, 3.0, canUndo = true)
    val timeline = SessionTimeline(turns, listOf(restore))
    assertEquals(listOf("turn:c", "restore:r", "turn:b", "turn:a"), timeline.entries.map { it.id })
    assertEquals(restore, timeline.undoable)
  }

  @Test fun picksTheRoutedTurnElseTheNewestThatCanBeDiffed() {
    val timeline = SessionTimeline(turns)
    assertEquals(2, timeline.turn("b")?.number)
    assertEquals(3, timeline.turn(null)?.number)
    assertEquals(3, timeline.turn("gone")?.number)
  }

  @Test fun onlyAFinishedTurnWithItsCheckpointCanBeRestored() {
    assertEquals(listOf(false, true, false), turns.map { it.canRestore })
  }
}
