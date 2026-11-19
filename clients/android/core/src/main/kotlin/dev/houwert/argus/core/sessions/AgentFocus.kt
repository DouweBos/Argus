package dev.houwert.argus.core.sessions

/**
 * Which agent each session screen has in front. Keyed by session, or by agent while a screen
 * opened on one doesn't know its session yet. Immutable: every change returns a new value.
 */
data class AgentFocus(val byKey: Map<String, String> = emptyMap()) {
  /** The tab in front of a session, as its side panel reads it. */
  fun session(id: String): String? = byKey[id]

  fun withSession(id: String, agentId: String?): AgentFocus = copy(byKey = byKey.with(id, agentId))

  /** A screen was opened on [agentId]: it goes in front, over whatever its session last showed. */
  fun request(agentId: String, sessionId: String?): AgentFocus = copy(byKey = byKey + ((sessionId ?: agentId) to agentId))

  /**
   * The tab in front of a screen on a session, or on an agent in one. A request made before the
   * session was known still wins over the session's older pick.
   */
  fun front(sessionId: String?, agentId: String?): String? =
    agentId?.let { byKey[it] } ?: sessionId?.let { byKey[it] }

  /** Put [id] in front, under the session once it is known. */
  fun pick(id: String?, sessionId: String?, agentId: String?): AgentFocus {
    val key = sessionId ?: agentId ?: return this
    var next = byKey.with(key, id)
    if (sessionId != null && agentId != null) next = next - agentId
    return copy(byKey = next)
  }

  companion object {
    /** What a navigation stack newly put on screen: the routes past the prefix both stacks share. */
    fun <R> opened(old: List<R>, new: List<R>): List<R> {
      val shared = old.zip(new).takeWhile { (a, b) -> a == b }.size
      return new.drop(shared)
    }
  }
}

private fun Map<String, String>.with(key: String, value: String?): Map<String, String> =
  if (value == null) this - key else this + (key to value)
