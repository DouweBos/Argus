package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.net.TransportException
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteRunner
import kotlinx.coroutines.flow.update

// "Continue on": the chat goes on in a new agent on another runner, in the same session, seeded with what happened so far.

enum class ContinueSource(val rawValue: String) { LimitCard("limit_card"), Menu("menu") }

/** Installed runners other than the agent's own. */
fun HostStore.continueRunners(agentId: String): List<RemoteRunner> {
  val current = _statusByAgent.value[agentId]?.runnerId ?: "claude-code"
  return _runners.value.filter { (it.available ?: true) && it.id != current }
}

/** Between turns: two agents on one task in one worktree would collide. */
fun HostStore.canContinueElsewhere(agentId: String): Boolean {
  val status = _statusByAgent.value[agentId]?.status ?: return false
  return status != RemoteAgentStatusStatus.running
}

/** Starts the new agent and returns it; throws the host's reason. */
suspend fun HostStore.continueOnRunner(agentId: String, runnerId: String, source: ContinueSource): RemoteAgentStatus {
  val backend = backend ?: throw TransportException.NotReady()
  val agent = backend.request(
    Methods.AgentsContinueOnRunner,
    MethodsTypes.AgentsContinueOnRunnerParams(agentId, runnerId, MethodsTypes.AgentsContinueOnRunnerParamsSource(source.rawValue)),
  ).agent
  _statusByAgent.update { it + (agent.agentId to agent) }
  return agent
}
