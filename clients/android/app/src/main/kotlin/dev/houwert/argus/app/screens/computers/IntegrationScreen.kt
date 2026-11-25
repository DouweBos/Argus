package dev.houwert.argus.app.screens.computers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.screens.AppScreen
import dev.houwert.argus.app.telemetry.Telemetry
import dev.houwert.argus.app.telemetry.TelemetryEvent
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.IntegrationKind
import dev.houwert.argus.core.stores.connectIntegration
import dev.houwert.argus.core.stores.disconnectIntegration
import dev.houwert.argus.core.stores.integrations
import dev.houwert.argus.core.stores.loadIntegrations
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.IntegrationId
import dev.houwert.argus.kit.protocol.generated.IntegrationStatus
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.ControlRequiredBanner
import dev.houwert.argus.ui.components.SettingsGroup
import dev.houwert.argus.ui.components.SettingsItem
import dev.houwert.argus.ui.components.SettingsPage
import dev.houwert.argus.ui.components.SettingsRow
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.integrations.IntegrationLabels
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.launch

/** `/settings/integrations/:integration`: connect or disconnect one of the computer's integrations, as on the Mac. */
@Composable
fun IntegrationScreen(wire: String) {
  val kind = IntegrationKind.of(wire) ?: IntegrationKind.Linear
  AppScreen(kind.title) {
    SettingsPage {
      val id = kind.keyIntegration
      if (id != null) KeyIntegration(kind, id) else SlackIntegration()
    }
  }
}

/** Linear or Figma with a personal key. Browser sign-in answers on the computer's loopback, so it stays on the Mac. */
@Composable
private fun KeyIntegration(kind: IntegrationKind, id: IntegrationId) {
  val host = LocalAppStore.current.host
  val scope = rememberCoroutineScope()
  val integrations by host.integrations.collectAsState()
  val connection by host.connection.collectAsState()
  val capabilities by host.capabilities.collectAsState()
  val control = "control" in capabilities
  val status = integrations.firstOrNull { it.id == id }
  var key by remember { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }
  var reconnecting by remember { mutableStateOf(false) }
  var confirming by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  LaunchedEffect(connection) { if (connection == Transport.State.Ready) host.loadIntegrations() }

  fun connect() {
    if (!control || busy || key.isBlank()) return
    busy = true
    scope.launch {
      runAction(kind, TelemetryEvent.IntegrationAction.Connect, { host.connectIntegration(id, key) }) { error = it }
      if (error == null) {
        key = ""
        reconnecting = false
      }
      busy = false
    }
  }

  if (!control) ControlRequiredBanner("connect ${kind.title}")
  error?.let { Banner(it, tone = Tone.Danger) }
  if (status != null && status.connected && !reconnecting) {
    SettingsGroup(
      title = kind.title,
      footer = if (status.method?.rawValue == "oauth") "Signed in through the browser on the computer. Reconnecting here switches it to a key."
      else "The key stays in the computer's secret store; it never comes back to this phone.",
    ) {
      SettingsRow(
        IntegrationLabels.account(status) ?: kind.title,
        description = if (status.needsReauth) "${kind.title} stopped accepting the saved key. Connect again with a new one." else status.account?.email,
      ) { Badge(IntegrationLabels.state(status), tone = IntegrationLabels.tone(status)) }
      if (control) {
        SettingsItem {
          Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            Btn("Reconnect", tone = ButtonTone.Secondary, small = true, hugs = true) { reconnecting = true }
            Btn("Disconnect", tone = ButtonTone.Danger, small = true, hugs = true, busy = busy, enabled = !busy) { confirming = true }
          }
        }
      }
    }
  } else {
    SettingsGroup(
      title = kind.title,
      footer = kind.keyHelp + " It's checked with ${kind.title}, then kept in the computer's secret store and never sent back to this phone." +
        if (status?.oauthAvailable == true) " Signing in through the browser is in Argus on the computer." else "",
    ) {
      SettingsRow("API key", stacked = true) {
        ThemedTextField(key, { key = it }, "Paste the key", Modifier.fillMaxWidth(), mono = true, input = TextInput.Code, secure = true, onSubmit = ::connect)
      }
      SettingsItem {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
          if (reconnecting) Btn("Cancel", tone = ButtonTone.Secondary, small = true, hugs = true) { reconnecting = false; key = "" }
          Btn(if (busy) "Connecting" else "Connect", small = true, hugs = true, busy = busy, enabled = control && !busy && key.isNotBlank(), onClick = ::connect)
        }
      }
    }
  }

  if (confirming) {
    AlertDialog(
      onDismissRequest = { confirming = false },
      title = { Text("Disconnect ${kind.title}?") },
      text = { Text("Argus on the computer stops reading ${kind.title} until you connect it again.") },
      confirmButton = {
        TextButton({
          confirming = false
          busy = true
          scope.launch {
            runAction(kind, TelemetryEvent.IntegrationAction.Disconnect, { host.disconnectIntegration(id) }) { error = it }
            busy = false
          }
        }) { Text("Disconnect", color = ArgusTheme.colors.error) }
      },
      dismissButton = { TextButton({ confirming = false }) { Text("Cancel") } },
    )
  }
}

/** Runs one connect or disconnect, counts it, and hands back the computer's sentence on failure (null on success). */
internal suspend fun runAction(
  kind: IntegrationKind,
  action: TelemetryEvent.IntegrationAction,
  block: suspend () -> Unit,
  setError: (String?) -> Unit,
) {
  try {
    block()
    setError(null)
    Telemetry.capture(TelemetryEvent.IntegrationChanged(kind, action, success = true))
  } catch (e: Exception) {
    if (HostStore.isCancellation(e)) throw e
    setError(HostStore.describe(e))
    Telemetry.capture(TelemetryEvent.IntegrationChanged(kind, action, success = false))
  }
}

internal val IntegrationStatus.label: String get() = IntegrationLabels.account(this) ?: IntegrationLabels.state(this)
