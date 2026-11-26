package dev.houwert.argus.core.sessions

import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteProject
import dev.houwert.argus.kit.protocol.generated.RemoteSession

/**
 * Agents by session and project, live status laid over, in the order every client lists them: the
 * pure half of `HostStore+Grouping.swift`, over a snapshot of the store's lists.
 */
data class SessionGrouping(
  val projects: List<RemoteProject> = emptyList(),
  val sessionsByRepo: Map<String, List<RemoteSession>> = emptyMap(),
  val agentsByRepo: Map<String, List<RemoteAgentStatus>> = emptyMap(),
  /** The cross-project agent list. */
  val recentAgents: List<RemoteAgentStatus> = emptyList(),
  /** The latest status each agent announced. */
  val statusByAgent: Map<String, RemoteAgentStatus> = emptyMap(),
) {
  /** A session's agents, oldest first. */
  fun agentsInSession(session: RemoteSession): List<RemoteAgentStatus> {
    val listed = agentsByRepo[session.repoRoot].orEmpty().filter { it.sessionId == session.id }
    return AgentOrder.byCreation(AgentOrder.overlaid(listed, statusByAgent))
  }

  /** The same, plus any only the cross-project list has yet: for a session opened before its project's agents load. */
  fun agentsInSession(id: String, repoRoot: String): List<RemoteAgentStatus> {
    val seen = mutableSetOf<String>()
    val listed = (agentsByRepo[repoRoot].orEmpty() + recentAgents).filter { it.sessionId == id && seen.add(it.agentId) }
    return AgentOrder.byCreation(AgentOrder.overlaid(listed, statusByAgent))
  }

  /** The repo an agent works in, which picks its project badge's colour. */
  fun repoRootOfAgent(agent: RemoteAgentStatus, repoRootForSessionId: (String) -> String?): String? =
    repoRootForSessionId(agent.sessionId) ?: repoRootOfProjectNamed(agent.projectName)

  /** A project's repo by the name the gateway's shapes carry; null for none or an unlisted one. */
  fun repoRootOfProjectNamed(name: String?): String? {
    if (name.isNullOrEmpty()) return null
    return projects.firstOrNull { it.name == name }?.repoRoot
  }

  /** Every agent across projects: what wants you first, then the most recent. */
  val recentAgentsByActivity: List<RemoteAgentStatus>
    get() = AgentOrder.byActivity(AgentOrder.overlaid(recentAgents, statusByAgent))

  /**
   * A project's agents, from its own list and the cross-project one. An agent is placed by its
   * session; by project name only while the sessions are unknown and no other project shares the name.
   */
  fun agentsInProject(repoRoot: String): List<RemoteAgentStatus> {
    val seen = mutableSetOf<String>()
    val own = agentsByRepo[repoRoot].orEmpty().filter { seen.add(it.agentId) }
    val sessionIds = sessionsByRepo[repoRoot]?.map { it.id }?.toSet()
    val name = projects.firstOrNull { it.repoRoot == repoRoot }?.name
    val nameIsUnique = name != null && projects.count { it.name == name } == 1
    val recent = recentAgents.filter { agent ->
      when {
        agent.agentId in seen -> false
        sessionIds != null -> agent.sessionId in sessionIds
        else -> nameIsUnique && agent.projectName == name
      }
    }
    return own + recent
  }

  /** A project's sessions with their agents, the project root first. */
  fun sessionGroups(repoRoot: String): List<SessionGroup> =
    SessionGroup.make(sessionsByRepo[repoRoot].orEmpty().filter { it.crossProjectOf == null }, agentsInProject(repoRoot), statusByAgent)
}
