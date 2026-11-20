package dev.houwert.argus.app.screens.session

import dev.houwert.argus.app.navigation.Router
import dev.houwert.argus.core.sessions.AgentFocus
import kotlinx.coroutines.flow.MutableStateFlow
import java.util.WeakHashMap

/**
 * The session screens' share of navigation state, as the iPhone router keeps it:
 * which agent each session has in front, which sessions have a "New agent" tab
 * open, and the tablet side panel. Lives as long as the router, so a rotation keeps it.
 */
class SessionNav {
  val focused = MutableStateFlow(AgentFocus())
  val newAgentDrafts = MutableStateFlow(emptySet<String>())
  val panelOpen = MutableStateFlow(false)
  /** Chats on screen: a conversation needs the composer's room and is left by going back, so the tab bar hides. */
  val chatsShown = MutableStateFlow(0)

  fun setDrafting(sessionId: String, on: Boolean) {
    newAgentDrafts.value = if (on) newAgentDrafts.value + sessionId else newAgentDrafts.value - sessionId
  }

  fun focusSession(sessionId: String, agentId: String) {
    focused.value = focused.value.withSession(sessionId, agentId)
  }
}

private val navs = WeakHashMap<Router, SessionNav>()

val Router.sessionNav: SessionNav get() = navs.getOrPut(this) { SessionNav() }
