package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.LimitHandoffAccount
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import kotlinx.coroutines.flow.update

// Moving a chat stalled on a spent usage limit onto another of the computer's
// Claude accounts. Only on the user's pick; the host captures the telemetry.

/** Other accounts the agent could continue on; empty once the stall is over. */
suspend fun HostStore.limitHandoffAccounts(agentId: String): List<LimitHandoffAccount> {
  val backend = backend ?: return emptyList()
  return runCatching { backend.request(Methods.AgentsLimitHandoff, MethodsTypes.AgentsLimitHandoffParams(agentId)).accounts }.getOrDefault(emptyList())
}

/** Pin the session to [accountId], move the agent there and continue its turn. Throws the host's reason. */
suspend fun HostStore.handoffAgent(agentId: String, accountId: String) {
  val backend = backend ?: return
  backend.request(Methods.AgentsHandoffToAccount, MethodsTypes.AgentsHandoffToAccountParams(agentId, accountId))
  // Nothing re-broadcasts the session list on this write.
  val sessionId = _statusByAgent.value[agentId]?.sessionId ?: return
  _sessionsByRepo.update { byRepo ->
    byRepo.mapValues { (_, sessions) -> sessions.map { if (it.id == sessionId) it.copy(claudeAccountId = accountId) else it } }
  }
}
