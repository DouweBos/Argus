package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusAwaiting
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import org.junit.Assert.assertEquals
import org.junit.Test

class WidgetHostTest {
  private fun agent(id: String, status: RemoteAgentStatusStatus, awaiting: RemoteAgentStatusAwaiting? = null) =
    RemoteAgentStatus(agentId = id, sessionId = "s-$id", title = "Agent $id", status = status, awaiting = awaiting, lastActivityAt = 1000.0)

  @Test fun waitingFirstAndOnlyLiveAgents() {
    val rows = widgetAgents(
      listOf(
        agent("run", RemoteAgentStatusStatus.running),
        agent("idle", RemoteAgentStatusStatus.idle),
        agent("ask", RemoteAgentStatusStatus.requiresAction, RemoteAgentStatusAwaiting.permission),
      ),
      hostId = "h1",
    )
    assertEquals(listOf("ask", "run"), rows.map { it.id })
    assertEquals("argus://sessions/s-run/agents/run?host=h1&src=widget", rows[1].url)
  }

  @Test fun cutsAtTheLimit() {
    val rows = widgetAgents((1..12).map { agent("a$it", RemoteAgentStatusStatus.running) }, "h")
    assertEquals(WIDGET_AGENT_LIMIT, rows.size)
  }
}
