package dev.houwert.argus.app.screens.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.core.backend.RawCommand
import dev.houwert.argus.core.settings.WorktreeCleanupModel
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.refreshDeviceHosts
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteDeviceHost
import dev.houwert.argus.kit.protocol.generated.RemoteDeviceHostStatus
import dev.houwert.argus.kit.protocol.generated.RemotePermissionMode
import dev.houwert.argus.kit.protocol.label
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.GrantLabel
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.MenuChip
import dev.houwert.argus.ui.components.OnResume
import dev.houwert.argus.ui.components.PickerOption
import dev.houwert.argus.ui.components.SettingsGroup
import dev.houwert.argus.ui.components.SettingsItem
import dev.houwert.argus.ui.components.SettingsLayout
import dev.houwert.argus.ui.components.SettingsLinkRow
import dev.houwert.argus.ui.components.SettingsPage
import dev.houwert.argus.ui.components.SettingsRow
import dev.houwert.argus.ui.components.StatusDot
import dev.houwert.argus.ui.components.label
import dev.houwert.argus.ui.components.tone
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.settings.WorktreeCleanupSettings
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/* The connected computer's settings that a phone can see or change. */

@Composable
fun ConnectionSettingsPage() {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val theme = ArgusTheme.colors
  val connection by app.host.connection.collectAsState()
  val capabilities by app.host.capabilities.collectAsState()
  val identity by app.identity.collectAsState()
  SettingsPage {
    SettingsGroup(footer = "Change what this device may do under Settings → Remote in Argus on the computer.") {
      SettingsRow("Status") {
        val ready = connection == Transport.State.Ready
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
          StatusDot(if (ready) Tone.Success else Tone.Warning)
          Text(connection.label, color = if (ready) theme.success else theme.warning, style = argusFont(13))
        }
      }
      if (capabilities.isNotEmpty()) {
        SettingsRow("Access") { Text(GrantLabel.text(capabilities), color = theme.textSecondary, style = argusFont(13)) }
      }
    }
    identity?.let { computer ->
      SettingsGroup {
        SettingsLinkRow("Computer details", icon = Icon.desktop) { router.push(Route.Computer(computer.deviceId)) }
      }
    }
  }
}

@Composable
fun AgentsSettingsPage() {
  val prefs = LocalAppStore.current.prefs
  val mode by prefs.defaultPermissionMode.collectAsState()
  SettingsPage {
    SettingsGroup(title = "New agents") {
      SettingsRow("Default permission mode", description = "The mode new agents started from this phone begin in.") {
        MenuChip(
          "Default permission mode", mode,
          listOf(PickerOption<RemotePermissionMode?>(null, "Computer's default")) + RemotePermissionMode.entries.map { PickerOption(it, it.label) },
          prefs::setDefaultPermissionMode,
        )
      }
    }
  }
}

/** The automation autonomy rungs, lowest first, as the computer names them. */
private val autonomyRungs = listOf("propose" to "Propose", "draft" to "Draft", "pr" to "Pull request", "auto_merge" to "Auto-merge")
private val setDefaultAutonomy = RawCommand("automations.set_default_autonomy", JsonElement.serializer())

@Composable
fun AutomationsSettingsPage() {
  val host = LocalAppStore.current.host
  val connection by host.connection.collectAsState()
  var loaded by remember { mutableStateOf(false) }
  /** Null means no cap. */
  var autonomy by remember { mutableStateOf<String?>(null) }
  val scope = rememberCoroutineScope()
  LaunchedEffect(connection) {
    if (connection != Transport.State.Ready) return@LaunchedEffect
    runCatching { host.backend?.request(Methods.AutomationsDefaultAutonomy, MethodsTypes.AutomationsDefaultAutonomyParams()) }
      .onSuccess { result ->
        if (result != null) {
          autonomy = result.autonomy?.rawValue
          loaded = true
        }
      }
      .onFailure { host.report(it, "automations") }
  }
  SettingsPage {
    SettingsGroup(title = "Automations") {
      if (!loaded) {
        SettingsItem { Loading("Reading the computer's settings") }
      } else {
        SettingsRow(
          "Autonomy cap",
          description = "How far any automation on this computer may go on its own. A project can cap it lower, never higher.",
        ) {
          val options = listOf(PickerOption<String?>(null, "No cap")) + autonomyRungs.map { PickerOption<String?>(it.first, it.second) }
          if (host.hasControl) {
            MenuChip("Autonomy cap", autonomy, options, { next ->
              scope.launch {
                val params = buildJsonObject { put("autonomy", next?.let(::JsonPrimitive) ?: JsonNull) }
                runCatching { host.backend?.request(setDefaultAutonomy, params) }
                  .onSuccess { autonomy = next }
                  .onFailure { host.report(it, "automations") }
              }
            })
          } else {
            Text(options.first { it.value == autonomy }.label, color = ArgusTheme.colors.textSecondary, style = argusFont(13))
          }
        }
      }
    }
  }
}

@Composable
fun WorktreesSettingsPage() {
  val host = LocalAppStore.current.host
  val connection by host.connection.collectAsState()
  val model = remember(host) { WorktreeCleanupModel(host) }
  LaunchedEffect(connection) { if (connection == Transport.State.Ready) model.load() }
  OnResume(connection == Transport.State.Ready) { model.load() }
  SettingsPage { WorktreeCleanupSettings(model, canEdit = host.hasControl) }
}

@Composable
fun DeviceHostsSettingsPage() {
  val host = LocalAppStore.current.host
  val hosts by host.deviceHosts.collectAsState()
  LaunchedEffect(Unit) { host.refreshDeviceHosts() }
  OnResume(connected = true) { host.refreshDeviceHosts() }
  SettingsPage {
    SettingsGroup(
      title = "Device hosts",
      footer = "Other Macs this computer streams simulators from over SSH, and EAS Simulator hosts in Expo's cloud. " +
        "Add or remove them, and set Expo tokens, in Argus on the computer.",
    ) {
      if (hosts.isEmpty()) SettingsItem { Text("No device hosts on this computer.", color = ArgusTheme.colors.textSecondary, style = argusFont(13)) }
      hosts.forEach { entry ->
        if (entry.kind?.rawValue == "eas") EasHostRow(entry) else DeviceHostRow(entry, statusLabel(entry.status))
      }
    }
  }
}

private fun statusLabel(status: RemoteDeviceHostStatus) = when (status) {
  RemoteDeviceHostStatus.connected -> "Connected"
  RemoteDeviceHostStatus.unreachable -> "Unreachable"
  else -> "Not checked yet"
}

/** A device host's status dot, name and what it's doing. */
@Composable
private fun DeviceHostRow(entry: RemoteDeviceHost, detail: String, trailing: @Composable () -> Unit = {}) {
  val theme = ArgusTheme.colors
  val tone = when (entry.status) {
    RemoteDeviceHostStatus.connected -> Tone.Success
    RemoteDeviceHostStatus.unreachable -> Tone.Warning
    else -> Tone.Muted
  }
  Row(
    Modifier.fillMaxWidth().padding(SettingsLayout.rowPadding),
    horizontalArrangement = Arrangement.spacedBy(10.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    StatusDot(tone, Modifier.width(24.dp))
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(entry.label, color = theme.text, style = argusFont(15), maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text(
        detail, color = if (entry.status == RemoteDeviceHostStatus.unreachable) theme.warning else theme.textSecondary,
        style = argusFont(13), maxLines = 1,
      )
    }
    trailing()
  }
}

/** An EAS host: its running sessions and a way to start one, billed to the computer's Expo account, so it asks first. */
@Composable
private fun EasHostRow(entry: RemoteDeviceHost) {
  val host = LocalAppStore.current.host
  val theme = ArgusTheme.colors
  val scope = rememberCoroutineScope()
  var confirming by remember { mutableStateOf(false) }
  var busy by remember { mutableStateOf(false) }
  var note by remember { mutableStateOf<String?>(null) }
  var failed by remember { mutableStateOf(false) }
  val running = entry.runningSessions ?: 0
  val limit = entry.maxSessions ?: 0
  Column {
    DeviceHostRow(entry, "EAS · $running of $limit running") {
      if (host.hasControl) {
        Btn(if (busy) "Starting" else "Start", tone = ButtonTone.Secondary, small = true, hugs = true, enabled = !busy && running < limit) { confirming = true }
      }
    }
    note?.let {
      Text(it, Modifier.padding(start = 14.dp, end = 14.dp, bottom = 10.dp), color = if (failed) theme.error else theme.textSecondary, style = argusFont(12))
    }
  }
  if (confirming) {
    AlertDialog(
      onDismissRequest = { confirming = false },
      title = { Text("Start an EAS Simulator session?") },
      text = {
        Text(
          "It costs money: the session is billed to the Expo account on the computer until you end it, it sits idle, " +
            "or it reaches its time limit. It can take a few minutes to start."
        )
      },
      confirmButton = {
        TextButton({
          confirming = false
          busy = true
          failed = false
          note = null
          scope.launch {
            try {
              host.backend?.request(Methods.DeviceHostsStartEasSession, MethodsTypes.DeviceHostsStartEasSessionParams(entry.id))
              note = "Starting. The device shows up under Devices once it's ready."
            } catch (e: Exception) {
              failed = true
              note = HostStore.describe(e)
            } finally {
              busy = false
            }
          }
        }) { Text("Start session (billed)") }
      },
      dismissButton = { TextButton({ confirming = false }) { Text("Cancel") } },
    )
  }
}
