package dev.houwert.argus.ui.agent

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.core.agents.AgentMcpServers
import dev.houwert.argus.core.agents.AgentMcpServers.State
import dev.houwert.argus.core.agents.McpServerActivity
import dev.houwert.argus.core.stores.McpServerAction
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.FlowRow
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.components.StatusDot
import dev.houwert.argus.ui.icons.Icon as Glyph
import dev.houwert.argus.ui.icons.power
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch

/** What the MCP list can ask of the host; the screen binds each to a `HostStore` call. */
class McpServerCallbacks(
  /** Returns the sign-in page to open, if the action was a sign-in. */
  val act: suspend (server: String, action: McpServerAction, callbackUrl: String?) -> String?,
  val dismiss: (server: String) -> Unit,
  val retry: () -> Unit,
)

/**
 * The MCP servers the agent's CLI loaded and whether each connected. Names the
 * account the agent runs as, since connectors and sign-ins belong to an account.
 */
@Composable
fun AgentMcpServersView(
  servers: AgentMcpServers?,
  error: String?,
  accountName: String?,
  hasControl: Boolean,
  activity: (server: String) -> McpServerActivity?,
  callbacks: McpServerCallbacks,
  modifier: Modifier = Modifier,
) {
  val theme = ArgusTheme.colors
  val list = servers?.servers
  when {
    list != null ->
      Column(modifier.fillMaxSize()) {
        if (accountName != null) {
          Row(
            Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
          ) {
            Icon(Glyph.person, null, Modifier.size(14.dp), tint = theme.textSecondary)
            Text("Running as $accountName", style = argusFont(12), color = theme.textSecondary)
          }
          HorizontalDivider(color = theme.borderSubtle)
        }
        if (list.isEmpty()) {
          MutedText("This agent has no MCP servers", Modifier.padding(16.dp))
        } else {
          LazyColumn(Modifier.weight(1f, fill = false)) {
            items(list, key = { it.id }) { server ->
              McpServerRow(server, activity(server.name), hasControl, callbacks)
            }
          }
        }
        if (error != null) {
          Banner(error, Modifier.padding(8.dp), tone = Tone.Danger, actionLabel = "Retry", onAction = callbacks.retry)
        }
      }
    servers != null ->
      EmptyState(Glyph.mcp, "Not available", modifier, body = "This agent's CLI can't report its MCP servers.")
    error != null ->
      EmptyState(Glyph.warning, "Couldn't load MCP servers", modifier, body = error, selectable = true) {
        Btn("Retry", tone = ButtonTone.Secondary, small = true, icon = Glyph.refresh, hugs = true, onClick = callbacks.retry)
      }
    else -> Loading("Checking MCP servers", modifier.padding(16.dp))
  }
}

object McpServerText {
  fun tone(state: State): Tone =
    when (state) {
      State.Connected -> Tone.Success
      State.Pending -> Tone.Accent
      State.NeedsAuth -> Tone.Warning
      State.Failed -> Tone.Danger
      State.Disabled, is State.Other -> Tone.Muted
    }

  /** The one action the state asks for, offered as a button. */
  fun primary(state: State, hasControl: Boolean, activity: McpServerActivity?): McpServerAction? {
    if (!hasControl || activity != null) return null
    return when (state) {
      State.NeedsAuth -> McpServerAction.signIn
      State.Failed -> McpServerAction.reconnect
      State.Disabled -> McpServerAction.enable
      else -> null
    }
  }

  fun title(action: McpServerAction): String =
    when (action) {
      McpServerAction.signIn -> "Sign in"
      McpServerAction.reconnect -> "Reconnect"
      McpServerAction.enable -> "Enable"
      McpServerAction.disable -> "Disable"
      else -> action.rawValue.replaceFirstChar { it.uppercase() }
    }

  fun tools(count: Int?): String? = count?.let { if (it == 1) "1 tool" else "$it tools" }

  /** With a button in its place, the state moves into the detail line. */
  fun detail(server: AgentMcpServers.Server, primary: McpServerAction?, activity: McpServerActivity?): String? {
    if (activity is McpServerActivity.Failed) return activity.message
    if (server.state == State.Failed && server.error != null) return server.error
    val parts = listOfNotNull(if (primary == null) null else server.state.label, server.origin, tools(server.toolCount))
    return parts.takeIf { it.isNotEmpty() }?.joinToString(" · ")
  }

  fun detailIsError(server: AgentMcpServers.Server, activity: McpServerActivity?) =
    activity is McpServerActivity.Failed || server.state == State.Failed
}

/** One server: its state, and what can be done about it, as `/mcp` offers in a terminal. */
@Composable
private fun McpServerRow(
  server: AgentMcpServers.Server,
  activity: McpServerActivity?,
  hasControl: Boolean,
  callbacks: McpServerCallbacks,
) {
  val theme = ArgusTheme.colors
  val uri = LocalUriHandler.current
  val clipboard = LocalClipboardManager.current
  val scope = rememberCoroutineScope()
  val tone = McpServerText.tone(server.state)
  val primary = McpServerText.primary(server.state, hasControl, activity)
  val detail = McpServerText.detail(server, primary, activity)
  fun run(action: McpServerAction, callbackUrl: String? = null) {
    scope.launch { callbacks.act(server.name, action, callbackUrl)?.let { runCatching { uri.openUri(it) } } }
  }

  Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      StatusDot(tone, pulse = server.state == State.Pending, contentDescription = server.state.label)
      Spacer(Modifier.width(10.dp))
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
          server.displayName,
          style = argusFont(15),
          color = if (server.state == State.Disabled) theme.textSecondary else theme.text,
          maxLines = 1,
          overflow = TextOverflow.MiddleEllipsis,
        )
        if (detail != null) {
          SelectionContainer {
            Text(
              detail,
              style = argusFont(12),
              color = if (McpServerText.detailIsError(server, activity)) theme.error else theme.textMuted,
              maxLines = 2,
              overflow = TextOverflow.Ellipsis,
            )
          }
        }
      }
      Spacer(Modifier.width(8.dp))
      when {
        activity == McpServerActivity.Working ->
          CircularProgressIndicator(Modifier.size(16.dp), color = theme.textMuted, strokeWidth = 2.dp)
        primary != null -> Btn(McpServerText.title(primary), tone = ButtonTone.Secondary, small = true, hugs = true) { run(primary) }
        else -> Text(server.state.label, style = argusFont(12), color = if (tone == Tone.Muted) theme.textMuted else tone.color(theme))
      }
      if (hasControl && activity != McpServerActivity.Working) ServerMenu(server, ::run)
    }
    if (activity is McpServerActivity.SigningIn) {
      SigningIn(
        activity,
        paste = {
          val address = clipboard.getText()?.text?.trim().orEmpty()
          if (address.isNotEmpty()) run(McpServerAction.finishSignIn, address)
        },
        reconnect = { run(McpServerAction.reconnect) },
        openAgain = { runCatching { uri.openUri(activity.url) } },
        cancel = { callbacks.dismiss(server.name) },
      )
    }
  }
}

@Composable
private fun ServerMenu(server: AgentMcpServers.Server, run: (McpServerAction, String?) -> Unit) {
  var open by remember { mutableStateOf(false) }
  Box {
    IconBtn(Glyph.ellipsis, "Actions for ${server.displayName}") { open = true }
    DropdownMenu(open, { open = false }, containerColor = ArgusTheme.colors.surface) {
      @Composable
      fun item(label: String, icon: ImageVector, action: McpServerAction) =
        DropdownMenuItem(
          text = { Text(label, style = argusFont(15)) },
          leadingIcon = { Icon(icon, null, Modifier.size(18.dp)) },
          onClick = {
            open = false
            run(action, null)
          },
        )
      if (server.state != State.Disabled) item("Reconnect", Glyph.refresh, McpServerAction.reconnect)
      if (server.state == State.NeedsAuth || server.state == State.Failed) item("Sign in", Glyph.person, McpServerAction.signIn)
      HorizontalDivider(color = ArgusTheme.colors.borderSubtle)
      if (server.state == State.Disabled) item("Enable", Glyph.power, McpServerAction.enable)
      else item("Disable", Glyph.power, McpServerAction.disable)
    }
  }
}

/**
 * The sign-in page is open in the browser: open it again, or hand back the
 * address it ended on when that browser can't reach the agent (another device).
 */
@Composable
private fun SigningIn(
  activity: McpServerActivity.SigningIn,
  paste: () -> Unit,
  reconnect: () -> Unit,
  openAgain: () -> Unit,
  cancel: () -> Unit,
) {
  Column(Modifier.padding(start = 18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
    Text(
      if (activity.callbackExpected) {
        "Complete the sign-in in your browser. If it ends on a page that won't load, copy that page's address and paste it here."
      } else {
        "Complete the sign-in in your browser, then reconnect."
      },
      style = argusFont(12),
      color = ArgusTheme.colors.textSecondary,
    )
    FlowRow(spacing = 6.dp, rowSpacing = 6.dp, packed = true) {
      if (activity.callbackExpected) {
        Btn("Paste address", tone = ButtonTone.Secondary, small = true, icon = Glyph.link, hugs = true, onClick = paste)
      } else {
        Btn("Reconnect", tone = ButtonTone.Secondary, small = true, icon = Glyph.refresh, hugs = true, onClick = reconnect)
      }
      Btn("Open again", tone = ButtonTone.Ghost, small = true, hugs = true, onClick = openAgain)
      Btn("Cancel", tone = ButtonTone.Ghost, small = true, hugs = true, onClick = cancel)
    }
  }
}
