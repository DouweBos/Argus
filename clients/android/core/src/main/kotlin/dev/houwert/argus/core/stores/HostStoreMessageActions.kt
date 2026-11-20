package dev.houwert.argus.core.stores

import dev.houwert.argus.core.transcript.resendText
import dev.houwert.argus.kit.net.TransportException
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import kotlinx.coroutines.flow.update

// Edit and fork from a message. Both throw, so a sheet can show why it failed and stay open.

enum class MessageForkTarget(val rawValue: String) {
  /** A new session branched at the message. */
  Session("session"),
  /** A new agent in the message's own session. */
  Agent("agent"),
}

data class ForkedChat(val sessionId: String, val agent: RemoteAgentStatus)

/** Rewind the conversation to [message] and send [edited] in its place; everything after it is discarded. */
suspend fun HostStore.rewind(agentId: String, message: RemoteMessage, edited: String) {
  val backend = backend ?: throw TransportException.NotReady()
  backend.request(Methods.AgentsRewind, MethodsTypes.AgentsRewindParams(agentId, message.id, message.resendText(edited)))
}

/** Fork the chat up to [message] into a new agent; the host seeds its transcript. */
suspend fun HostStore.fork(
  agentId: String,
  message: RemoteMessage,
  into: MessageForkTarget,
  description: String? = null,
  branch: String? = null,
): ForkedChat {
  val backend = backend ?: throw TransportException.NotReady()
  val result = backend.request(
    Methods.AgentsFork,
    MethodsTypes.AgentsForkParams(
      agentId, message.id, MethodsTypes.AgentsForkParamsInto(into.rawValue),
      description?.trim()?.ifEmpty { null }, branch?.trim()?.ifEmpty { null },
    ),
  )
  val agent = result.agent
  _statusByAgent.update { it + (agent.agentId to agent) }
  // The host carried the source's effort over; the composer reads it from here.
  agent.effort?.let { effort -> _effortByAgent.update { it + (agent.agentId to effort) } }
  // A forked session lands in the source's project; list it before anyone opens it.
  val repoRoot = _statusByAgent.value[agentId]?.sessionId?.let { repoRoot(it) }
  if (repoRoot != null) {
    if (into == MessageForkTarget.Session) loadSessions(repoRoot)
    loadAgents(repoRoot)
  }
  return ForkedChat(result.sessionId, agent)
}
