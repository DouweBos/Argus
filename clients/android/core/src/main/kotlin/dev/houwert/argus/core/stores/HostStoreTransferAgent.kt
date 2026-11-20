package dev.houwert.argus.core.stores

import dev.houwert.argus.core.sessions.isDone
import dev.houwert.argus.kit.net.TransportException
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteProject
import dev.houwert.argus.kit.protocol.generated.RemoteSession
import dev.houwert.argus.kit.protocol.generated.RemoteSessionStatus
import dev.houwert.argus.kit.protocol.isOutsideProjects
import dev.houwert.argus.kit.protocol.isUnavailable
import kotlinx.coroutines.flow.update

// "Move to": the chat goes on in another session, in this project or another, and the old agent stops.

/** One project's places a chat can move to: ready sessions to join, minus the chat's own and finished ones. */
data class MoveDestination(val project: RemoteProject, val sessions: List<RemoteSession>) {
  val id: String get() = project.repoRoot
}

/** Where a chat went: its session, and its agent unless that waits on a new session's setup. */
data class MovedChat(val sessionId: String, val agent: RemoteAgentStatus?)

/** Every project, the chat's own first, with the sessions it could join. */
fun HostStore.moveDestinations(agentId: String): List<MoveDestination> {
  val here = _statusByAgent.value[agentId]?.sessionId
  val hereRepo = here?.let { id -> _sessionsByRepo.value.values.flatten().firstOrNull { it.id == id }?.repoRoot }
  val projects = _projects.value
  val ordered = projects.filter { it.repoRoot == hereRepo } + projects.filter { it.repoRoot != hereRepo }
  return ordered.map { project ->
    MoveDestination(
      project,
      _sessionsByRepo.value[project.repoRoot].orEmpty().filter {
        it.id != here && it.status == RemoteSessionStatus.ready && !it.isUnavailable && !it.isOutsideProjects && !it.isDone
      },
    )
  }
}

/** Moves the chat into [sessionId], or a new session in [repoRoot]. */
suspend fun HostStore.transferAgent(agentId: String, sessionId: String? = null, repoRoot: String? = null): MovedChat {
  val backend = backend ?: throw TransportException.NotReady()
  val result = backend.request(Methods.AgentsTransfer, MethodsTypes.AgentsTransferParams(agentId, sessionId, repoRoot))
  result.agent?.let { agent -> _statusByAgent.update { it + (agent.agentId to agent) } }
  return MovedChat(result.sessionId, result.agent)
}
