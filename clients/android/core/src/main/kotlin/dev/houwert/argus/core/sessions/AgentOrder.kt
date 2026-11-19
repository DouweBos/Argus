package dev.houwert.argus.core.sessions

import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionKind

/**
 * How agent lists are ordered. Every list lays the live status over the listed one first, so a
 * running agent sorts (and reads) as running.
 */
object AgentOrder {
  /** Each agent with the latest status (and title) it announced, where there is one. */
  fun overlaid(agents: List<RemoteAgentStatus>, live: Map<String, RemoteAgentStatus>): List<RemoteAgentStatus> =
    agents.map { live[it.agentId] ?: it }

  /** What wants you first, then the most recently active. */
  fun byActivity(agents: List<RemoteAgentStatus>): List<RemoteAgentStatus> =
    agents.sortedWith(compareBy<RemoteAgentStatus> { activityRank(it) }.thenByDescending { lastActivity(it) })

  /** Oldest first: a session's agents in the order its tabs opened. */
  fun byCreation(agents: List<RemoteAgentStatus>): List<RemoteAgentStatus> = agents.sortedBy { it.createdAt ?: 0.0 }

  /**
   * A session screen's tabs, oldest first: its live agents, plus the [kept] ones it has shown that
   * stopped since, so a shut-down tab stays (with its Resume) until closed.
   */
  fun sessionTabs(
    listed: List<RemoteAgentStatus>,
    kept: List<String>,
    status: (String) -> RemoteAgentStatus?,
    isGone: (String) -> Boolean,
  ): List<RemoteAgentStatus> {
    val keep = kept.toSet()
    val tabs = listed.filter { !isGone(it.agentId) || it.agentId in keep }.toMutableList()
    for (id in kept) {
      if (tabs.none { it.agentId == id }) status(id)?.let(tabs::add)
    }
    return byCreation(tabs)
  }

  /** [agents] in a dragged [order]: the ones it names first, in its order, then the rest as they came. */
  fun arranged(agents: List<RemoteAgentStatus>, order: List<String>?): List<RemoteAgentStatus> {
    if (order.isNullOrEmpty()) return agents
    val rank = rankOf(order)
    val placed = agents.filter { it.agentId in rank }.sortedBy { rank.getValue(it.agentId) }
    return placed + agents.filter { it.agentId !in rank }
  }

  /** [ids] with [id] dropped into [target]'s slot; null when that changes nothing. */
  fun moved(id: String, target: String, ids: List<String>): List<String>? {
    val from = ids.indexOf(id)
    val to = ids.indexOf(target)
    if (id == target || from < 0 || to < 0) return null
    return ids.toMutableList().apply { add(to, removeAt(from)) }
  }

  /** The tab that takes over when [closing] closes: the one before it, else the one after. */
  fun neighbour(closing: String, ids: List<String>): String? {
    val index = ids.indexOf(closing)
    if (index < 0) return ids.firstOrNull()
    val rest = ids.filter { it != closing }
    return if (rest.isEmpty()) null else rest[(index - 1).coerceIn(0, rest.size - 1)]
  }

  /** The next or previous of [ids] from [current], wrapping; null when there is nowhere to go. */
  fun cycled(ids: List<String>, current: String?, offset: Int): String? {
    if (ids.size < 2 || current == null) return null
    val index = ids.indexOf(current)
    if (index < 0) return null
    return ids[((index + offset) % ids.size + ids.size) % ids.size]
  }

  /** Sort weight: anything that wants you outranks anything merely recent (ArgusKit's `Labels`). */
  internal fun activityRank(agent: RemoteAgentStatus): Int {
    if (agent.awaiting != null || agent.status == RemoteAgentStatusStatus.requiresAction) return 0
    return when (agent.status) {
      RemoteAgentStatusStatus.running -> 1
      RemoteAgentStatusStatus.error -> 2
      RemoteAgentStatusStatus.idle -> 3
      RemoteAgentStatusStatus.stopped -> 4
      else -> 5
    }
  }

  /** When the agent last showed a sign of life; creation time until it speaks. */
  internal fun lastActivity(agent: RemoteAgentStatus): Double = agent.lastActivityAt ?: agent.createdAt ?: 0.0
}

/** A session and the agents in it, as a project's screen lists them. */
data class SessionGroup(
  val id: String,
  /** The session's name, else its branch; the agents' label when the session isn't listed yet. */
  val label: String,
  /** Null when only its agents are known, before the project's sessions load. */
  val session: RemoteSession?,
  /** Oldest first, live status laid over. */
  val agents: List<RemoteAgentStatus>,
) {
  val isRoot: Boolean get() = session?.kind == RemoteSessionKind.projectRoot

  companion object {
    /** The project root first, then the sessions in the host's order, then any session only its agents mention. */
    fun make(
      sessions: List<RemoteSession>,
      agents: List<RemoteAgentStatus>,
      live: Map<String, RemoteAgentStatus> = emptyMap(),
    ): List<SessionGroup> {
      val labels = LinkedHashMap<String, Pair<String, RemoteSession?>>()
      val agentsById = HashMap<String, MutableList<RemoteAgentStatus>>()
      // Stacked sessions follow their parent, as the sidebar draws them.
      for (entry in SessionStack.ordered(sessions)) {
        val session = entry.session
        labels.putIfAbsent(session.id, (session.displayName ?: session.branch) to session)
      }
      for (agent in AgentOrder.overlaid(agents, live)) {
        labels.putIfAbsent(agent.sessionId, (agent.sessionLabel ?: "Session") to null)
        agentsById.getOrPut(agent.sessionId) { mutableListOf() }.add(agent)
      }
      val groups = labels.map { (id, value) ->
        SessionGroup(id, value.first, value.second, AgentOrder.byCreation(agentsById[id].orEmpty()))
      }
      return groups.filter { it.isRoot } + groups.filter { !it.isRoot }
    }
  }
}

/** The sidebar's search and narrowing, as plain functions over the lists. */
object SessionSearch {
  /** Case-blind; an empty query matches nothing. */
  fun matches(text: String, query: String): Boolean {
    val trimmed = query.trim()
    return trimmed.isNotEmpty() && text.contains(trimmed, ignoreCase = true)
  }

  /** A session matches by its title, its branch or its project's name. */
  fun matches(session: RemoteSession, projectName: String?, query: String): Boolean =
    listOf(projectName ?: "", session.displayName ?: "", session.branch).any { matches(it, query) }

  /** Worktrees to list: the search's matches, else all unless folded shut. */
  fun visibleWorktrees(worktrees: List<RemoteSession>, shown: Set<String>?, collapsed: Boolean): List<RemoteSession> =
    when {
      shown != null -> worktrees.filter { it.id in shown }
      collapsed -> emptyList()
      else -> worktrees
    }

  /** Stable sort by the rank of whatever [key] names; unknown keys go last. */
  fun <T, K> ordered(items: List<T>, order: List<K>, key: (T) -> K): List<T> {
    val rank = rankOf(order)
    return items.sortedBy { rank[key(it)] ?: Int.MAX_VALUE }
  }
}

/** Each key's first index. */
private fun <K> rankOf(order: List<K>): Map<K, Int> {
  val rank = HashMap<K, Int>()
  order.forEachIndexed { index, key -> rank.putIfAbsent(key, index) }
  return rank
}
