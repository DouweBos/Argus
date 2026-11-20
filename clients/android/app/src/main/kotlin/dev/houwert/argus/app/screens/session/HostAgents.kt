package dev.houwert.argus.app.screens.session

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus

/** Shut down, or stopped on its own: it can't take new messages. */
fun HostStore.isGone(agentId: String): Boolean =
  agentId in goneAgents.value || statusByAgent.value[agentId]?.status == RemoteAgentStatusStatus.stopped
