package dev.houwert.argus.app.screens.computers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import dev.houwert.argus.app.screens.AppScreen
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.storage.DeviceIdentity
import dev.houwert.argus.ui.components.Badge
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.ButtonTone
import dev.houwert.argus.ui.components.GrantLabel
import dev.houwert.argus.ui.components.SettingsGroup
import dev.houwert.argus.ui.components.SettingsItem
import dev.houwert.argus.ui.components.SettingsLayout
import dev.houwert.argus.ui.components.SettingsPage
import dev.houwert.argus.ui.components.SettingsRow
import dev.houwert.argus.ui.components.StatusDot
import dev.houwert.argus.ui.components.TextInput
import dev.houwert.argus.ui.components.ThemedTextField
import dev.houwert.argus.ui.components.label
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import dev.houwert.argus.ui.theme.argusFont
import java.text.DateFormat
import java.util.Date
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** One paired computer: what it granted this phone, how it's reached, and how to leave it. */
@Composable
fun ComputerScreen(deviceId: String) {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val hosts by app.pairedHosts.collectAsState()
  val computer = hosts.firstOrNull { it.deviceId == deviceId }
  AppScreen(computer?.label ?: "Computer") {
    SettingsPage {
      if (computer == null) {
        SettingsGroup {
          SettingsItem {
            Text("This computer is no longer paired.", color = ArgusTheme.colors.textSecondary, style = argusFont(13))
            Btn("Back", Modifier.padding(top = 8.dp), tone = ButtonTone.Secondary, small = true, hugs = true) { router.popToRoot() }
          }
        }
      } else {
        ComputerContent(computer)
      }
    }
  }
}

@Composable
private fun ComputerContent(computer: DeviceIdentity) {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val theme = ArgusTheme.colors
  val scope = rememberCoroutineScope()
  val activeId by app.activeHostId.collectAsState()
  val connection by app.host.connection.collectAsState()
  val active = computer.deviceId == activeId
  val ready = active && connection == Transport.State.Ready
  var confirmingUnpair by remember { mutableStateOf(false) }

  SettingsGroup(title = "Connection") {
    SettingsRow(if (active) connection.label else "Not connected", description = GrantLabel.text(computer.capabilities)) {
      if (active) {
        StatusDot(if (ready) Tone.Success else Tone.Warning)
      } else {
        Btn("Connect", small = true, hugs = true) {
          scope.launch {
            app.selectHost(computer.deviceId)
            router.popToRoot()
          }
        }
      }
    }
  }

  if (!computer.isAccountHost) NameGroup(computer)

  SettingsGroup(
    title = "Addresses",
    footer = "Every route this computer advertised: Wi-Fi, Tailscale when both devices are on your tailnet, and the tunnel " +
      "it gets from your Argus account. The simplest one that answers wins, and a better one is picked up when your network changes.",
  ) {
    computer.candidateEndpoints.forEach { endpoint ->
      Row(
        Modifier.fillMaxWidth().padding(SettingsLayout.rowPadding),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Text(
          DeviceIdentity.gatewayHost(endpoint.url), Modifier.weight(1f), color = theme.text, style = argusFont(14, mono = true),
          maxLines = 1, overflow = TextOverflow.MiddleEllipsis,
        )
        if (endpoint.url == computer.url && ready) Badge("In use", tone = Tone.Success)
        Badge(endpoint.kind.label)
      }
    }
  }

  SettingsGroup(title = "Gateway") {
    // Account computers carry a synthetic device id; show the host's own.
    val hostId = computer.accountHostId
    if (computer.isAccountHost && hostId != null) {
      SettingsRow("Computer", description = "${hostId.take(8)} on your Argus account")
    } else {
      SettingsRow("Device", description = computer.deviceId.take(8))
    }
    computer.pairedAt?.let { SettingsRow("Paired", description = DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(it.toLong()))) }
  }

  if (!computer.isAccountHost) {
    SettingsGroup(
      footer = "Removes this computer's key from the phone. Nothing on the computer changes — revoke the device there to cut it off for good.",
    ) {
      Box(Modifier.fillMaxWidth().padding(SettingsLayout.rowPadding), contentAlignment = Alignment.CenterEnd) {
        Btn("Unpair", tone = ButtonTone.Danger, small = true, hugs = true) { confirmingUnpair = true }
      }
    }
  }

  if (confirmingUnpair) {
    AlertDialog(
      onDismissRequest = { confirmingUnpair = false },
      title = { Text("Unpair “${computer.label}”?") },
      text = { Text("This phone loses access until you pair with that computer again. Revoke it in Argus too if the phone was lost.") },
      confirmButton = {
        TextButton({
          confirmingUnpair = false
          scope.launch {
            app.unpairHost(computer.deviceId)
            router.popToRoot()
          }
        }) { Text("Unpair", color = theme.error) }
      },
      dismissButton = { TextButton({ confirmingUnpair = false }) { Text("Cancel") } },
    )
  }
}

@Composable
private fun NameGroup(computer: DeviceIdentity) {
  val app = LocalAppStore.current
  val scope = rememberCoroutineScope()
  var name by remember { mutableStateOf(computer.label) }
  var saved by remember { mutableStateOf(false) }
  LaunchedEffect(computer.label) { name = computer.label }
  val savable = name.isNotBlank() && name != computer.label
  fun save() {
    if (!savable) return
    scope.launch {
      app.renameHost(computer.deviceId, name)
      saved = true
      delay(1200)
      saved = false
    }
  }
  SettingsGroup(title = "Name", footer = "Only shown on this phone.") {
    SettingsRow("Name", stacked = true) {
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        ThemedTextField(name, { name = it }, "Computer name", Modifier.weight(1f), input = TextInput.Name, onSubmit = ::save)
        Btn(if (saved) "Saved" else "Save", tone = ButtonTone.Secondary, small = true, hugs = true, enabled = savable, onClick = ::save)
      }
    }
  }
}
