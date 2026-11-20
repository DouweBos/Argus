package dev.houwert.argus.core.agents

import dev.houwert.argus.kit.protocol.generated.MethodsTypes

/** An agent's MCP servers as its CLI sees them, the ones that need attention first. */
data class AgentMcpServers(
  /** Null when the agent's CLI can't report MCP status. */
  val servers: List<Server>?,
  /** The Claude account the agent runs as; null from an older host. */
  val accountId: String?,
) {
  sealed interface State {
    data object Connected : State
    data object Pending : State
    data object NeedsAuth : State
    data object Failed : State
    data object Disabled : State
    data class Other(val raw: String) : State

    val label: String
      get() = when (this) {
        Connected -> "Connected"
        Pending -> "Connecting"
        NeedsAuth -> "Needs sign-in"
        Failed -> "Failed"
        Disabled -> "Disabled"
        is Other -> raw.replaceFirstChar { it.uppercase() }
      }

    val rank: Int
      get() = when (this) {
        Failed -> 0
        NeedsAuth -> 1
        is Other -> 2
        Pending -> 3
        Connected -> 4
        Disabled -> 5
      }

    companion object {
      fun of(raw: String): State = when (raw) {
        "connected" -> Connected
        "pending" -> Pending
        "needs-auth" -> NeedsAuth
        "failed" -> Failed
        "disabled" -> Disabled
        else -> Other(raw)
      }
    }
  }

  data class Server(val name: String, val state: State, val source: String?, val toolCount: Int?, val error: String?) {
    val id: String get() = name

    /** `plugin:team-tools:linear` reads as `linear`; the plugin goes in [origin]. */
    val displayName: String
      get() = if (!name.startsWith("plugin:")) name else name.split(":", limit = 3).last()

    /** Where the server's config came from, as the user would name it. */
    val origin: String?
      get() {
        if (name.startsWith("plugin:")) {
          val parts = name.split(":")
          return if (parts.size == 3) "${parts[1]} plugin" else "Plugin"
        }
        return when (source) {
          "claudeai" -> "claude.ai connector"
          "user" -> "User config"
          "project" -> "Project .mcp.json"
          "local" -> "Local config"
          "dynamic" -> "Argus"
          null -> null
          else -> source.replaceFirstChar { it.uppercase() }
        }
      }
  }

  val connectedCount: Int get() = servers?.count { it.state == State.Connected } ?: 0

  /** Servers that won't work until someone acts: failed or waiting on a sign-in. */
  val problemCount: Int get() = servers?.count { it.state == State.Failed || it.state == State.NeedsAuth } ?: 0

  companion object {
    fun of(result: MethodsTypes.AgentsMcpStatusResult) = AgentMcpServers(
      servers = result.servers?.map { Server(it.name, State.of(it.status), it.source, it.toolCount?.toInt(), it.error) }
        ?.sortedWith(compareBy<Server> { it.state.rank }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.displayName }),
      accountId = result.accountId,
    )
  }
}

/** One MCP server being reconnected, toggled or signed in to. */
sealed interface McpServerActivity {
  data object Working : McpServerActivity
  /** The sign-in page is open; [callbackExpected]: the agent finishes it itself (or from a pasted address). */
  data class SigningIn(val url: String, val callbackExpected: Boolean) : McpServerActivity
  data class Failed(val message: String) : McpServerActivity
}
