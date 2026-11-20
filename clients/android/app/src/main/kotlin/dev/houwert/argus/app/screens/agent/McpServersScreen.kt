package dev.houwert.argus.app.screens.agent

import dev.houwert.argus.app.telemetry.TelemetryEvent
import dev.houwert.argus.app.telemetry.Telemetry
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.screens.AppScreen
import dev.houwert.argus.core.stores.actOnMcpServer
import dev.houwert.argus.core.stores.dismissMcpServerActivity
import dev.houwert.argus.core.stores.followMcpServers
import dev.houwert.argus.core.stores.loadMcpServers
import dev.houwert.argus.core.stores.mcpServerActivity
import dev.houwert.argus.core.stores.mcpServersKey
import dev.houwert.argus.kit.protocol.displayName
import dev.houwert.argus.ui.agent.AgentMcpServersView
import dev.houwert.argus.ui.agent.McpServerCallbacks
import kotlinx.coroutines.launch

/** The agent's MCP servers, re-followed whenever it respawns or moves to another account. */
@Composable
fun McpServersScreen(route: Route.McpServers) {
  val host = LocalAppStore.current.host
  val scope = rememberCoroutineScope()
  val agentId = route.agentId
  val servers by host.mcpServersByAgent.collectAsState()
  val errors by host.mcpServersErrorByAgent.collectAsState()
  val activities by host.mcpServerActivity.collectAsState()
  LaunchedEffect(agentId) { Telemetry.capture(TelemetryEvent.McpServersOpened) }
  val accounts by host.claudeAccounts.collectAsState()
  val capabilities by host.capabilities.collectAsState()
  // Read so the key below recomputes when the agent's status or account changes.
  val agents by host.agentsByRepo.collectAsState()
  val statuses by host.statusByAgent.collectAsState()
  val key = remember(agents, statuses, accounts, agentId) { host.mcpServersKey(agentId) }
  LaunchedEffect(key) { host.followMcpServers(agentId) }

  val current = servers[agentId]
  val accountName = current?.accountId?.takeIf { (accounts?.size ?: 0) > 1 }?.let { id ->
    accounts?.firstOrNull { it.id == id }?.displayName
  }
  val callbacks = remember(agentId) {
    McpServerCallbacks(
      act = { server, action, callbackUrl -> host.actOnMcpServer(agentId, server, action, callbackUrl) },
      dismiss = { host.dismissMcpServerActivity(agentId, it) },
      retry = { scope.launch { host.loadMcpServers(agentId) } },
    )
  }
  AppScreen("MCP servers") {
    AgentMcpServersView(
      servers = current,
      error = errors[agentId],
      accountName = accountName,
      hasControl = "control" in capabilities,
      activity = { name -> activities.let { host.mcpServerActivity(agentId, name) } },
      callbacks = callbacks,
    )
  }
}
