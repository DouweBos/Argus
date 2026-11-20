package dev.houwert.argus.app.screens.devices

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.screens.AppScreen
import dev.houwert.argus.core.stores.refreshDevices
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.RemoteDevice
import dev.houwert.argus.kit.protocol.generated.RemoteDevicePlatform
import dev.houwert.argus.ui.components.EmptyState
import dev.houwert.argus.ui.components.ListSection
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.components.LoadPhaseBox
import dev.houwert.argus.ui.components.MutedText
import dev.houwert.argus.ui.devices.DeviceRow
import dev.houwert.argus.ui.icons.Icon
import kotlinx.coroutines.launch

/** Simulators and emulators booted on the computer. Polled: there is no push channel for the set. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DevicesScreen() {
  val host = LocalAppStore.current.host
  val router = LocalRouter.current
  val devices by host.devices.collectAsState()
  val loaded by host.devicesLoaded.collectAsState()
  val connection by host.connection.collectAsState()
  val scope = rememberCoroutineScope()
  var refreshing by remember { mutableStateOf(false) }

  LiveRefresh(enabled = connection == Transport.State.Ready) { host.refreshDevices() }

  AppScreen("Devices") {
    LoadPhaseBox(
      loaded = loaded, error = null, isEmpty = devices.isEmpty(), modifier = Modifier.fillMaxSize(),
      loadingLabel = "Looking for devices",
      empty = {
        EmptyState(
          Icon.devices, "No devices running",
          body = "Boot a simulator or emulator in Argus on your computer and it'll show up here.",
        )
      },
    ) {
      PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
          scope.launch {
            refreshing = true
            host.refreshDevices()
            refreshing = false
          }
        },
      ) {
        val groups = groups(devices)
        LazyColumn(
          Modifier.fillMaxSize(),
          contentPadding = PaddingValues(16.dp),
          verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
          item(key = "summary") {
            MutedText("${devices.size} total · ${devices.count { it.booted }} running", Modifier.padding(horizontal = 16.dp))
          }
          items(groups, key = { it.first ?: "" }) { (label, members) ->
            // One section on the computer alone would only repeat the title.
            ListSection(header = if (groups.size > 1) label ?: "This computer" else null, dividerInset = 56.dp) {
              members.forEach { device ->
                DeviceRow(
                  device.name, detail(device), device.booted, device.isTv, device.capturing,
                  onClick = { router.push(Route.Device(device.id, device.platform.rawValue, device.name, device.isTv)) },
                )
              }
            }
          }
        }
      }
    }
  }
}

/** The computer's own devices first, then each device host. */
private fun groups(devices: List<RemoteDevice>): List<Pair<String?, List<RemoteDevice>>> =
  devices.groupBy { it.deviceHostLabel }.toList().sortedBy { it.first ?: "" }

private fun detail(device: RemoteDevice): String {
  val kind = if (device.platform == RemoteDevicePlatform.ios) "Simulator" else "Emulator"
  val runtime = device.runtime?.takeIf { it.isNotEmpty() } ?: kind
  return if (device.booted) runtime else "$runtime · Stopped"
}
