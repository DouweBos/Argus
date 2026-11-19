package dev.houwert.argus.kit.util

import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatusStatus
import kotlin.test.Test
import kotlin.test.assertEquals

class AgentNameTest {
  private fun agent(id: String, title: String? = null, created: Double, session: String = "s") =
    RemoteAgentStatus(agentId = id, sessionId = session, title = title, status = RemoteAgentStatusStatus.idle, createdAt = created)

  @Test fun untitledSiblingsNumberByStartTime() {
    val first = agent("b", created = 1.0)
    val titled = agent("a", title = "Fix login", created = 2.0)
    val second = agent("c", created = 3.0)
    val tabs = listOf(second, titled, first)
    assertEquals(listOf("New agent 2", "Fix login", "New agent"), tabs.map { Labels.agentName(it, tabs) })
  }

  @Test fun aLoneUntitledAgentIsJustNewAgent() {
    val mine = agent("a", created = 2.0)
    val elsewhere = agent("b", created = 1.0, session = "other")
    assertEquals("New agent", Labels.agentName(mine, listOf(mine, elsewhere)))
    assertEquals("New agent", Labels.agentName(mine, emptyList()))
  }
}
