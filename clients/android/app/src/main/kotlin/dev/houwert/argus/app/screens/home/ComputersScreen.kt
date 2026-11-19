package dev.houwert.argus.app.screens.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.kit.storage.DeviceIdentity
import dev.houwert.argus.ui.components.Btn
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.IconBtn
import dev.houwert.argus.ui.components.Loading
import dev.houwert.argus.ui.components.TopBarScreen
import dev.houwert.argus.ui.components.argusClickable
import dev.houwert.argus.ui.components.label
import dev.houwert.argus.ui.components.rememberInteraction
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme
import kotlinx.coroutines.launch

/**
 * The computers this phone is paired with. Picking one connects to it (only one at a time) and
 * opens its projects; the info button opens its details.
 */
@Composable
fun ComputersScreen() {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val theme = ArgusTheme.colors
  val loaded by app.loaded.collectAsState()
  val hosts by app.pairedHosts.collectAsState()
  val active by app.activeHostId.collectAsState()
  val connection by app.host.connection.collectAsState()
  val scope = rememberCoroutineScope()

  TopBarScreen("Computers", onBack = router::pop) {
    when {
      !loaded -> Loading("Unlocking")
      hosts.isEmpty() -> EmptyState(
        Icon.desktop, "No computers yet",
        body = "Pair with one by QR code from Settings → Remote in Argus on the computer.",
      ) { Btn("Scan a QR code", hugs = true) { router.push(Route.Pair) } }
      else -> LazyColumn(Modifier.fillMaxSize()) {
        items(hosts, key = { it.deviceId }) { computer ->
          val isActive = computer.deviceId == active
          HostRow(
            computer, isActive, if (isActive) connection.label else DeviceIdentity.gatewayHost(computer.url),
            // Navigate first, connect second: racing endpoints takes seconds, and Home shows "connecting".
            onOpen = { scope.launch { app.selectHost(computer.deviceId) }; router.popToRoot() },
            onDetails = { router.push(Route.Computer(computer.deviceId)) },
          )
          HorizontalDivider(Modifier.padding(start = 52.dp), color = theme.borderSubtle)
        }
        item {
          Text(
            "Tap a computer to connect to it; the app talks to one at a time.",
            Modifier.padding(horizontal = 16.dp, vertical = 8.dp), color = theme.textMuted, style = ArgusTheme.typography.footnote,
          )
        }
        item {
          Row(
            Modifier.fillMaxWidth().argusClickable(rememberInteraction(), label = "Pair with a QR code") { router.push(Route.Pair) }.padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically,
          ) {
            Icon(Icon.qrCode, null, Modifier.size(22.dp), tint = theme.accent)
            Text("Pair with a QR code", color = theme.accent, style = ArgusTheme.typography.body)
          }
        }
      }
    }
  }
}

@Composable
private fun HostRow(computer: DeviceIdentity, active: Boolean, subtitle: String, onOpen: () -> Unit, onDetails: () -> Unit) {
  val theme = ArgusTheme.colors
  Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    Row(
      Modifier.weight(1f).argusClickable(rememberInteraction(), label = if (active) "${computer.label}, connected" else "Connect to ${computer.label}", onClick = onOpen)
        .padding(start = 16.dp, top = 12.dp, bottom = 12.dp),
      horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
      Icon(if (active) Icon.check else Icon.desktop, null, Modifier.size(22.dp), tint = if (active) theme.accent else theme.textSecondary)
      Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(computer.label, color = theme.text, style = ArgusTheme.typography.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(subtitle, color = theme.textMuted, style = ArgusTheme.typography.footnote, maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
    }
    IconBtn(Icon.details, "${computer.label} details", tint = theme.accent, onClick = onDetails)
  }
}
