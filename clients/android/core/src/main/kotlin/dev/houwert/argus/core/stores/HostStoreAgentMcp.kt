package dev.houwert.argus.core.stores

import dev.houwert.argus.core.agents.AgentMcpServers
import dev.houwert.argus.core.agents.McpServerActivity
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

typealias McpServerAction = MethodsTypes.AgentsMcpServerParamsAction

// Which MCP servers an agent reached, live from its CLI: with several Claude
// accounts, each agent can see a different set of connectors.

suspend fun HostStore.loadMcpServers(agentId: String) {
  val backend = backend ?: return
  try {
    val result = backend.request(Methods.AgentsMcpStatus, MethodsTypes.AgentsMcpStatusParams(agentId))
    _mcpServersByAgent.update { it + (agentId to AgentMcpServers.of(result)) }
    _mcpServersErrorByAgent.update { it - agentId }
  } catch (e: Exception) {
    // A poll that lost its connection keeps what it had and retries on reconnect.
    if (HostStore.isQuiet(e)) return
    _mcpServersErrorByAgent.update { it + (agentId to HostStore.describe(e)) }
    hooks.errorReported(e, "mcp_status")
  }
}

private fun HostStore.agentListed(agentId: String) = _agentsByRepo.value.values.asSequence().flatten().firstOrNull { it.agentId == agentId }

/** The account an agent should run as: its session's pin, else the computer's active account. */
fun HostStore.expectedClaudeAccountId(agentId: String): String? {
  val sessionId = agentListed(agentId)?.sessionId ?: _statusByAgent.value[agentId]?.sessionId
  val pin = sessionId?.let { session(it)?.claudeAccountId }?.takeIf { it.isNotEmpty() }
  if (pin != null && (_claudeAccounts.value?.any { it.id == pin } != false)) return pin
  return _activeClaudeAccountId.value
}

/** What a view watching an agent's MCP servers reloads on: switching accounts respawns the agent under the same id. */
fun HostStore.mcpServersKey(agentId: String): String =
  "$agentId:${expectedClaudeAccountId(agentId) ?: "-"}:${agentListed(agentId)?.status?.rawValue ?: "-"}"

/** Load, then keep reloading while the agent hasn't reached its account yet or a server is still connecting. */
suspend fun HostStore.followMcpServers(agentId: String, interval: Duration = 2.seconds, attempts: Int = 30) {
  for (attempt in 1..maxOf(attempts, 1)) {
    loadMcpServers(agentId)
    val servers = _mcpServersByAgent.value[agentId] ?: return
    if (_mcpServersErrorByAgent.value[agentId] != null) return
    val expected = expectedClaudeAccountId(agentId)
    val onAccount = expected == null || servers.accountId == null || servers.accountId == expected
    val connecting = servers.servers?.any { it.state == AgentMcpServers.State.Pending } ?: false
    if (attempt >= attempts || (onAccount && !connecting)) return
    delay(interval)
  }
}

internal fun mcpServerKey(agentId: String, server: String) = "$agentId\u0000$server"

fun HostStore.mcpServerActivity(agentId: String, server: String): McpServerActivity? =
  _mcpServerActivity.value[mcpServerKey(agentId, server)]

private fun HostStore.setActivity(key: String, activity: McpServerActivity?) =
  _mcpServerActivity.update { if (activity == null) it - key else it + (key to activity) }

/** Acts on one of the agent's MCP servers, as `/mcp` does in a terminal. Returns the page to open for a sign-in. */
suspend fun HostStore.actOnMcpServer(agentId: String, server: String, action: McpServerAction, callbackUrl: String? = null): String? {
  val backend = backend ?: return null
  val key = mcpServerKey(agentId, server)
  val previous = _mcpServerActivity.value[key]
  setActivity(key, McpServerActivity.Working)
  try {
    val result = backend.request(Methods.AgentsMcpServer, MethodsTypes.AgentsMcpServerParams(agentId, server, action, callbackUrl))
    val url = result.authUrl
    if (action == McpServerAction.signIn && url != null) {
      setActivity(key, McpServerActivity.SigningIn(url, result.callbackExpected))
      scope.launch { followSignIn(agentId, server) }
      return url
    }
    setActivity(key, null)
    followMcpServers(agentId)
  } catch (e: Exception) {
    // A pasted address that didn't take leaves the sign-in open to try again.
    if (previous is McpServerActivity.SigningIn && action == McpServerAction.finishSignIn) setActivity(key, previous)
    else setActivity(key, McpServerActivity.Failed(HostStore.describe(e)))
    hooks.errorReported(e, "mcp_server")
  }
  return null
}

fun HostStore.dismissMcpServerActivity(agentId: String, server: String) = setActivity(mcpServerKey(agentId, server), null)

/** Watches a sign-in until the server connects (the agent reconnects it on its own) or ten minutes pass. */
internal suspend fun HostStore.followSignIn(agentId: String, server: String, interval: Duration = 3.seconds) {
  val key = mcpServerKey(agentId, server)
  repeat(200) {
    delay(interval)
    if (_mcpServerActivity.value[key] !is McpServerActivity.SigningIn) return
    loadMcpServers(agentId)
    if (_mcpServersByAgent.value[agentId]?.servers?.firstOrNull { it.name == server }?.state == AgentMcpServers.State.Connected) {
      setActivity(key, null)
      return
    }
  }
}
