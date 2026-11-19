package dev.houwert.argus.core.sessions

import dev.houwert.argus.kit.protocol.generated.RemoteSession
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SessionStackTest {
  private fun stacked(id: String, parent: String? = null, compare: Pair<String, Long>? = null) =
    session(id, branch = id, parent = parent, compare = compare)

  @Test
  fun ordersUnderParents() {
    val ordered = SessionStack.ordered(listOf(stacked("c", "b"), stacked("x"), stacked("a"), stacked("b", "a")))
    assertEquals(listOf("x", "a", "b", "c"), ordered.map { it.id })
    assertEquals(listOf(0, 0, 1, 2), ordered.map { it.depth })
  }

  @Test
  fun orphanAtTop() {
    assertEquals(listOf(0), SessionStack.ordered(listOf(stacked("b", "gone"))).map { it.depth })
  }

  @Test
  fun cycleKept() {
    val ordered = SessionStack.ordered(listOf(stacked("a", "b"), stacked("b", "a")))
    assertEquals(setOf("a", "b"), ordered.map { it.id }.toSet())
  }

  @Test
  fun members() {
    val sessions = listOf(stacked("a"), stacked("b", "a"), stacked("c", "b"), stacked("x"))
    assertEquals(listOf("a", "b", "c"), SessionStack.members("c", sessions).map { it.id })
    assertEquals("a", SessionStack.root("c", sessions)?.id)
    assertEquals(emptyList(), SessionStack.members("x", sessions))
  }

  @Test
  fun splitAcrossSections() {
    val all = listOf(stacked("a"), stacked("b", "a"), stacked("c", "b"))
    // `a` sits in Needs you; `b` and `c` are working.
    val working = SessionStack.place(listOf(all[2], all[1]), { s: RemoteSession -> s }, all)
    assertEquals(listOf("b", "c"), working.map { it.item.id })
    assertEquals(listOf(0, 1), working.map { it.depth })
    assertEquals("a", working.first().parentElsewhere?.id)
    assertNull(working.last().parentElsewhere)
    assertEquals("On top of a", SessionStack.caption(working.first().parentElsewhere))
  }

  @Test
  fun coexistsWithCompare() {
    val sessions = listOf(stacked("c", "a"), stacked("x1", compare = "run" to 0L), stacked("a"), stacked("x2", compare = "run" to 1L))
    val arranged = SessionStack.arrange(sessions, { s: RemoteSession -> s }, sessions)
    assertEquals(listOf("x1", "a", "c", "x2"), arranged.items.map { it.id })
    assertEquals(1, arranged.nesting["c"]?.depth)
  }
}
