package dev.houwert.argus.core.sessions

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class AgentFocusTest {
  @Test
  fun requestBeatsStalePick() {
    val focus = AgentFocus().pick("a1", sessionId = "s1", agentId = null).request(agentId = "a2", sessionId = "s1")
    assertEquals("a2", focus.front(sessionId = "s1", agentId = "a2"))
    assertEquals("a2", focus.session("s1"))
  }

  @Test
  fun requestBeforeSessionKnown() {
    var focus = AgentFocus().pick("a1", sessionId = "s1", agentId = null).request(agentId = "a2", sessionId = null)
    assertEquals("a2", focus.front(sessionId = null, agentId = "a2"))
    assertEquals("a2", focus.front(sessionId = "s1", agentId = "a2"))
    // Filed under the session once it resolves, so the side panel agrees.
    focus = focus.pick("a2", sessionId = "s1", agentId = "a2")
    assertEquals(mapOf("s1" to "a2"), focus.byKey)
  }

  @Test
  fun pickAfterRequest() {
    val focus = AgentFocus().request(agentId = "a2", sessionId = null).pick("a3", sessionId = "s1", agentId = "a2")
    assertEquals("a3", focus.front(sessionId = "s1", agentId = "a2"))
  }

  @Test
  fun sessionKeepsPick() {
    val focus = AgentFocus().pick("a1", sessionId = "s1", agentId = null)
    assertEquals("a1", focus.front(sessionId = "s1", agentId = null))
    assertNull(focus.front(sessionId = "s2", agentId = null))
  }

  @Test
  fun opened() {
    assertEquals(listOf(3), AgentFocus.opened(listOf(1, 2), listOf(1, 2, 3)))
    assertEquals(emptyList(), AgentFocus.opened(listOf(1, 2, 3), listOf(1, 2)))
    assertEquals(listOf(4), AgentFocus.opened(listOf(1, 2), listOf(1, 4)))
    assertEquals(listOf(5), AgentFocus.opened(emptyList(), listOf(5)))
    assertEquals(emptyList(), AgentFocus.opened(listOf(1), listOf(1)))
  }
}
