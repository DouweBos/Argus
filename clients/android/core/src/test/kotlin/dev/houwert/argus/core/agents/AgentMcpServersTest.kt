package dev.houwert.argus.core.agents

import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteMcpServerStatus
import kotlin.test.assertEquals
import kotlin.test.assertNull
import org.junit.Test

class AgentMcpServersTest {
  private fun servers(list: List<RemoteMcpServerStatus>?) = AgentMcpServers.of(MethodsTypes.AgentsMcpStatusResult(list, "acc-1"))

  @Test fun failuresAndSignInsComeFirstDisabledLastByNameWithinAState() {
    val result = servers(
      listOf(
        RemoteMcpServerStatus("zeta", "connected"),
        RemoteMcpServerStatus("off", "disabled"),
        RemoteMcpServerStatus("alpha", "connected"),
        RemoteMcpServerStatus("claude.ai Slack", "needs-auth", source = "claudeai"),
        RemoteMcpServerStatus("posthog", "failed", error = "boom"),
      ),
    )
    assertEquals(listOf("posthog", "claude.ai Slack", "alpha", "zeta", "off"), result.servers?.map { it.name })
    assertEquals(2, result.connectedCount)
    assertEquals(2, result.problemCount)
    assertEquals("acc-1", result.accountId)
  }

  @Test fun aPluginsServerReadsByItsOwnNameWithThePluginAsItsOrigin() {
    val server = servers(listOf(RemoteMcpServerStatus("plugin:team-tools:linear", "connected", source = "plugin"))).servers?.first()
    assertEquals("linear", server?.displayName)
    assertEquals("team-tools plugin", server?.origin)
  }

  @Test fun anUnknownStatusSurvivesAndARunnerThatCantReportGivesNull() {
    assertEquals(AgentMcpServers.State.Other("starting"), servers(listOf(RemoteMcpServerStatus("x", "starting"))).servers?.first()?.state)
    assertNull(servers(null).servers)
    assertEquals(0, servers(null).problemCount)
  }
}
