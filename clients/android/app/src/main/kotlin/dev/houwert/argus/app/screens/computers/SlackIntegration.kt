package dev.houwert.argus.app.screens.computers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.telemetry.TelemetryEvent
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.IntegrationKind
import dev.houwert.argus.core.stores.connectSlack
import dev.houwert.argus.core.stores.disconnectSlack
import dev.houwert.argus.core.stores.loadSlackStatus
import dev.houwert.argus.core.stores.slackManifest
import dev.houwert.argus.core.stores.slackWorkspaces
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.SlackStatus
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.ControlRequiredBanner
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.SettingsGroup
import dev.houwert.argus.ui.components.SettingsItem
import dev.houwert.argus.ui.components.SettingsRow
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.integrations.SlackStatusRows
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Slack on the connected computer, one group per workspace: each its own app's two tokens, typed here and kept
 * encrypted there. Who besides
 * the owner may use it stays on the Mac, since that list decides who can run agents on the computer.
 */
@Composable
internal fun SlackIntegration() {
  val host = LocalAppStore.current.host
  val scope = rememberCoroutineScope()
  val workspaces by host.slackWorkspaces.collectAsState()
  val connection by host.connection.collectAsState()
  val capabilities by host.capabilities.collectAsState()
  val control = "control" in capabilities
  var busy by remember { mutableStateOf(false) }
  var disconnecting by remember { mutableStateOf<SlackStatus?>(null) }
  var error by remember { mutableStateOf<String?>(null) }
  LaunchedEffect(connection) { if (connection == Transport.State.Ready) host.loadSlackStatus() }

  if (!control) ControlRequiredBanner("connect Slack")
  error?.let { Banner(it, tone = Tone.Danger) }
  val known = workspaces
  when {
    known != null -> {
      for (workspace in known) SlackWorkspace(workspace, control, busy) { disconnecting = workspace }
      SlackConnect(control, busy, adding = known.isNotEmpty()) { bot, app, cleared ->
        busy = true
        scope.launch {
          runAction(IntegrationKind.Slack, TelemetryEvent.IntegrationAction.Connect, { host.connectSlack(bot, app) }) { error = it }
          if (error == null) cleared()
          busy = false
        }
      }
    }
    connection == Transport.State.Ready -> Loading("Checking Slack")
  }

  disconnecting?.let { workspace ->
    val teamId = workspace.teamId ?: return@let
    AlertDialog(
      onDismissRequest = { disconnecting = null },
      title = { Text("Disconnect ${workspace.workspace ?: "Slack"}?") },
      text = { Text("The bot stops answering. Its tokens are deleted from the computer; owner and channel projects stay.") },
      confirmButton = {
        TextButton({
          disconnecting = null
          busy = true
          scope.launch {
            runAction(IntegrationKind.Slack, TelemetryEvent.IntegrationAction.Disconnect, { host.disconnectSlack(teamId) }) { error = it }
            busy = false
          }
        }) { Text("Disconnect", color = ArgusTheme.colors.error) }
      },
      dismissButton = { TextButton({ disconnecting = null }) { Text("Cancel") } },
    )
  }
}

@Composable
private fun SlackWorkspace(status: SlackStatus, control: Boolean, busy: Boolean, onDisconnect: () -> Unit) {
  val clipboard = LocalClipboardManager.current
  val code = status.claimCode
  SettingsGroup(
    title = status.workspace ?: "Slack",
    footer = if (status.configured && status.owner == null && code == null) "Argus on the computer shows the code to claim the bot with." else null,
  ) {
    SlackStatusRows(status)
    SettingsRow("Allowed members", description = if (status.allowedUsers.isEmpty()) "Only the owner" else null) {
      Text("${status.allowedUsers.size}", color = ArgusTheme.colors.textSecondary, style = argusFont(15))
    }
    if (control && status.configured && status.teamId != null) {
      SettingsItem {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
          Btn("Disconnect", tone = ButtonTone.Danger, small = true, hugs = true, busy = busy, enabled = !busy, onClick = onDisconnect)
        }
      }
    }
  }
  if (status.owner == null && code != null) {
    SettingsGroup(
      title = "Claim the bot",
      footer = "Send the bot this code in a direct message to become its owner. Until someone does, it answers nobody.",
    ) {
      SettingsItem {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
          SelectionContainer(Modifier.weight(1f)) {
            Text(code, color = ArgusTheme.colors.accent, style = argusFont(22, FontWeight.SemiBold).copy(fontFamily = FontFamily.Monospace))
          }
          Btn("Copy", tone = ButtonTone.Secondary, small = true, icon = Icon.copy, hugs = true) { clipboard.setText(AnnotatedString(code)) }
        }
      }
    }
  }
}

@Composable
private fun SlackConnect(control: Boolean, busy: Boolean, adding: Boolean, onConnect: (String, String, () -> Unit) -> Unit) {
  val host = LocalAppStore.current.host
  val scope = rememberCoroutineScope()
  val clipboard = LocalClipboardManager.current
  val uri = LocalUriHandler.current
  var bot by remember { mutableStateOf("") }
  var app by remember { mutableStateOf("") }
  var copied by remember { mutableStateOf(false) }
  val canConnect = control && !busy && bot.isNotBlank() && app.isNotBlank()
  fun connect() {
    if (!canConnect) return
    onConnect(bot, app) {
      bot = ""
      app = ""
    }
  }
  SettingsGroup(
    title = if (adding) "Add a workspace" else "Slack",
    footer = "Argus reaches Slack over an outbound connection. The tokens are checked with Slack, then encrypted on the computer; " +
      "they never come back to this phone. Allowed members and channel projects decide who can run agents on the computer, " +
      "so they're chosen in Argus there.",
  ) {
    SettingsRow(
      "Slack app",
      description = "Mention the bot or message it, and an agent starts on the computer. Create the app in your workspace from this " +
        "manifest, install it, then paste its tokens below.",
      stacked = true,
    ) {
      Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Btn("Open Slack Apps", tone = ButtonTone.Secondary, small = true, hugs = true) { uri.openUri("https://api.slack.com/apps") }
        Btn(if (copied) "Copied" else "Copy Manifest", tone = ButtonTone.Secondary, small = true, hugs = true) {
          scope.launch {
            try {
              clipboard.setText(AnnotatedString(host.slackManifest()))
              copied = true
              delay(2000)
              copied = false
            } catch (e: Exception) {
              if (HostStore.isCancellation(e)) throw e
            }
          }
        }
      }
    }
    SettingsRow("Bot token", description = "Install App → Bot User OAuth Token, starting xoxb-.", stacked = true) {
      ThemedTextField(bot, { bot = it }, "xoxb-", Modifier.fillMaxWidth(), mono = true, input = TextInput.Code, secure = true)
    }
    SettingsRow(
      "App-level token",
      description = "Basic Information → App-Level Tokens, with the connections:write scope, starting xapp-.",
      stacked = true,
    ) {
      ThemedTextField(app, { app = it }, "xapp-", Modifier.fillMaxWidth(), mono = true, input = TextInput.Code, secure = true, onSubmit = ::connect)
    }
    SettingsItem {
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Btn(if (busy) "Connecting" else "Connect", small = true, hugs = true, busy = busy, enabled = canConnect, onClick = ::connect)
      }
    }
  }
}
