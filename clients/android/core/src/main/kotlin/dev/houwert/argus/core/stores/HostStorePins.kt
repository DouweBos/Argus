package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.protocol.generated.RemoteStoppedAgent
import dev.houwert.argus.kit.protocol.isPinned
import kotlinx.coroutines.flow.update

// Pinned chats: the host resumes them on its next start, owns the pin and captures its telemetry.

fun HostStore.isPinned(agentId: String) = _statusByAgent.value[agentId]?.isPinned == true

/** Pinning needs the agent live; unpinning works on one already stopped. */
fun HostStore.canTogglePin(agentId: String): Boolean {
  val status = _statusByAgent.value[agentId] ?: return false
  return status.isPinned || (status.status != RemoteAgentStatusStatus.stopped && status.status != RemoteAgentStatusStatus.error)
}

suspend fun HostStore.setPinned(agentId: String, pinned: Boolean) {
  val result = requestPin(MethodsTypes.AgentsSetPinnedParams(agentId = agentId, pinned = pinned)) ?: return
  _statusByAgent.update { map -> map[agentId]?.let { map + (agentId to it.copy(pinned = result)) } ?: map }
}

/** Pin a saved chat; it comes back on the next start under the agent id it last ran as. */
suspend fun HostStore.setPinned(chat: RemoteStoppedAgent, repoRoot: String, pinned: Boolean) {
  val result = requestPin(MethodsTypes.AgentsSetPinnedParams(repoRoot = repoRoot, historyId = chat.historyId, pinned = pinned)) ?: return
  _stoppedByRepo.update { map ->
    map[repoRoot]?.let { list -> map + (repoRoot to list.map { if (it.historyId == chat.historyId) it.copy(pinned = result) else it }) } ?: map
  }
}

/** A hand-resumed agent takes over its conversation's pin from the stopped one. */
internal fun HostStore.notePinMoved(oldAgentId: String, resumed: RemoteAgentStatus) {
  if (!resumed.isPinned) return
  _statusByAgent.update { map -> map[oldAgentId]?.let { map + (oldAgentId to it.copy(pinned = false)) } ?: map }
}

private suspend fun HostStore.requestPin(params: MethodsTypes.AgentsSetPinnedParams): Boolean? {
  val backend = backend ?: return null
  return try {
    backend.request(Methods.AgentsSetPinned, params).pinned
  } catch (e: Exception) {
    report(e)
    null
  }
}
