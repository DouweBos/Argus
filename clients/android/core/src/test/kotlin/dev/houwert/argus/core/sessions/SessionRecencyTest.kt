package dev.houwert.argus.core.sessions

import dev.houwert.argus.kit.protocol.generated.RemoteSessionKind
import kotlin.test.Test
import kotlin.test.assertEquals

class SessionRecencyTest {
  @Test
  fun newestFirstAndUnstampedLastInTheirOrder() {
    val sorted = SessionRecency.sorted(
      listOf(session("a"), session("old", lastMessageAt = 1.0), session("b"), session("new", lastMessageAt = 3.0)),
    )
    assertEquals(listOf("new", "old", "a", "b"), sorted.map { it.id })
  }

  @Test
  fun aCompareRunSortsByItsNewestSlotAndStaysTogether() {
    val sorted = SessionRecency.sorted(
      listOf(
        session("x", lastMessageAt = 5.0),
        session("slot1", lastMessageAt = 1.0, compare = "r" to 0L),
        session("y", lastMessageAt = 3.0),
        session("slot2", lastMessageAt = 9.0, compare = "r" to 1L),
      ),
    )
    assertEquals(listOf("slot1", "slot2", "x", "y"), sorted.map { it.id })
  }

  @Test
  fun aStackSortsByItsNewestSessionWithTheParentFirst() {
    val sorted = SessionRecency.sorted(
      listOf(
        session("x", lastMessageAt = 5.0),
        session("parent", lastMessageAt = 1.0),
        session("child", lastMessageAt = 9.0, parent = "parent"),
      ),
    )
    assertEquals(listOf("parent", "child", "x"), sorted.map { it.id })
  }

  @Test
  fun triageSortsEachGroupAndKeepsThePhoneRootOnTop() {
    val sessions = listOf(session("a", lastMessageAt = 1.0), session("b", lastMessageAt = 2.0), session("c"))
    assertEquals(listOf("b", "a", "c"), SessionTriage(sessions) { emptyList() }.active.map { it.id })
    val root = session("root", kind = RemoteSessionKind.projectRoot)
    val groups = SessionGroup.make(listOf(root) + sessions, emptyList())
    assertEquals(listOf("root", "b", "a", "c"), SessionGroupTriage(groups).active.map { it.id })
  }
}
