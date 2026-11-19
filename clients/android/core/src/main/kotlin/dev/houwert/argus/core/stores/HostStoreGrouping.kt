package dev.houwert.argus.core.stores

import dev.houwert.argus.core.sessions.SessionGroup
import dev.houwert.argus.core.sessions.SessionGrouping
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine

// Agents by session and project, live status laid over, in the order both apps list them.

/** The store's lists as one value; screens recompute from it when any of them moves. */
val HostStore.grouping: SessionGrouping
  get() = SessionGrouping(projects.value, sessionsByRepo.value, agentsByRepo.value, recentAgents.value, statusByAgent.value)

/** [grouping], as a flow a screen can collect. */
val HostStore.groupingFlow: Flow<SessionGrouping>
  get() = combine(projects, sessionsByRepo, agentsByRepo, recentAgents, statusByAgent) { p, s, a, r, st -> SessionGrouping(p, s, a, r, st) }

/** A session's agents, oldest first. */
fun HostStore.agents(inSession: RemoteSession): List<RemoteAgentStatus> = grouping.agentsInSession(inSession)

/** The same, plus any only the cross-project list has yet: a session opened before its project's agents load. */
fun HostStore.agents(inSessionId: String, repoRoot: String): List<RemoteAgentStatus> = grouping.agentsInSession(inSessionId, repoRoot)

/** The repo an agent works in, which picks its project badge's colour. */
fun HostStore.repoRoot(ofAgent: RemoteAgentStatus): String? = grouping.repoRootOfAgent(ofAgent) { repoRoot(it) }

/** Every agent across projects: what wants you first, then the most recent. */
val HostStore.recentAgentsByActivity: List<RemoteAgentStatus> get() = grouping.recentAgentsByActivity

fun HostStore.agents(inProject: String): List<RemoteAgentStatus> = grouping.agentsInProject(inProject)

/** A project's sessions with their agents, the project root first. */
fun HostStore.sessionGroups(repoRoot: String): List<SessionGroup> = grouping.sessionGroups(repoRoot)
