package dev.houwert.argus.core.stores

import dev.houwert.argus.core.routing.ArgusLocation
import dev.houwert.argus.core.routing.ArgusRoute
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import dev.houwert.argus.kit.util.Labels
import dev.houwert.argus.kit.widgets.WidgetLink
import dev.houwert.argus.kit.widgets.WidgetSnapshot

/** Past this many rows no widget size has room, and the counts carry the rest. */
const val WIDGET_AGENT_LIMIT = 8

/** This computer's slice of the widgets, from what the store already holds. Proposals and usage come from their own stores. */
fun HostStore.widgetHost(
  id: String,
  name: String,
  now: Long = System.currentTimeMillis(),
  proposals: List<WidgetSnapshot.Proposal> = emptyList(),
  proposalCount: Int = proposals.size,
  usage: List<WidgetSnapshot.UsageAccount> = emptyList(),
): WidgetSnapshot.Host = WidgetSnapshot.Host(id, name, now, widgetAgents(recentAgentsByActivity, id), proposals, proposalCount, usage)

/** Waiting agents first, so the cut never drops one that needs you; idle and stopped ones aren't shown. */
fun widgetAgents(agents: List<RemoteAgentStatus>, hostId: String): List<WidgetSnapshot.Agent> {
  val rows = agents.mapNotNull { agent ->
    val attention = Labels.awaitingLabel(agent) ?: if (agent.status == RemoteAgentStatusStatus.requiresAction) "needs you" else null
    if (attention == null && agent.status != RemoteAgentStatusStatus.running) return@mapNotNull null
    val location = ArgusLocation(ArgusRoute.Session(agent.sessionId, agent.agentId), hostId)
    WidgetSnapshot.Agent(
      id = agent.agentId,
      title = Labels.agentName(agent),
      project = agent.projectName,
      attention = attention,
      activityAt = agent.lastActivityAt?.toLong(),
      url = WidgetLink.url(location.path),
    )
  }
  return (rows.filter { it.needsYou } + rows.filter { !it.needsYou }).take(WIDGET_AGENT_LIMIT)
}

/** A proposal row, linking to it on its own computer. */
fun widgetProposal(id: String, title: String, hostId: String): WidgetSnapshot.Proposal =
  WidgetSnapshot.Proposal(id, title, WidgetLink.url(ArgusLocation(ArgusRoute.Proposal(id), hostId).path))
