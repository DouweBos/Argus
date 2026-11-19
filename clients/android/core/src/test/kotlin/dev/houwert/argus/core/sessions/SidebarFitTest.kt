package dev.houwert.argus.core.sessions

import dev.houwert.argus.core.sessions.SidebarFit.State
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SidebarFitTest {
  @Test
  fun hidesAndReturns() {
    val hidden = SidebarFit.fit(State(shown = true, autoHidden = false), cramped = true)
    assertEquals(State(shown = false, autoHidden = true), hidden)
    assertEquals(State(shown = true, autoHidden = false), SidebarFit.fit(hidden, cramped = false))
  }

  @Test
  fun userHidden() {
    val state = State(shown = false, autoHidden = false)
    assertEquals(state, SidebarFit.fit(state, cramped = false))
    assertEquals(state, SidebarFit.fit(state, cramped = true))
  }

  @Test
  fun widths() {
    fun cramped(width: Double) = SidebarFit.panelCramped(width, sidebar = 300.0, panel = 300.0, chat = 380.0)
    assertTrue(cramped(834.0))
    assertFalse(cramped(1210.0))
    assertFalse(cramped(1032.0))
    assertFalse(cramped(0.0))
  }
}
