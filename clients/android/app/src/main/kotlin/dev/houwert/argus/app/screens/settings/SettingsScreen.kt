package dev.houwert.argus.app.screens.settings

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.screens.AppScreen
import dev.houwert.argus.app.screens.account.AccountProfileSummary
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.telemetry.Telemetry
import dev.houwert.argus.app.telemetry.TelemetryMode
import dev.houwert.argus.core.stores.refreshDeviceHosts
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.ui.components.SettingsGroup
import dev.houwert.argus.ui.components.SettingsLinkRow
import dev.houwert.argus.ui.components.SettingsPage
import dev.houwert.argus.ui.components.label
import dev.houwert.argus.ui.icons.Icon

/** A settings sub-page: the phone's own first, then the connected computer's. */
enum class SettingsPane(val raw: String, val title: String, val icon: ImageVector) {
  Name("name", "Name", Icon.textCursor),
  Appearance("appearance", "Appearance", Icon.palette),
  Alerts("alerts", "Alerts", Icon.alerts),
  Privacy("privacy", "Privacy", Icon.privacy),
  Connection("connection", "Connection", Icon.connection),
  Agents("agents", "Agents", Icon.agents),
  Automations("automations", "Automations", Icon.automations),
  Worktrees("worktrees", "Worktrees", Icon.drive),
  DeviceHosts("device_hosts", "Device Hosts", Icon.devices);

  val route: Route get() = Route.SettingsPage(raw)

  companion object {
    fun of(raw: String) = entries.firstOrNull { it.raw == raw }
  }
}

/** "phone" or "tablet", for copy that names this device. */
@Composable
internal fun deviceNoun(): String = if (LocalConfiguration.current.smallestScreenWidthDp >= 600) "tablet" else "phone"

/** Settings as a list of pages: this phone, the computer it's connected to, and the computers it knows. */
@Composable
fun SettingsScreen() {
  val app = LocalAppStore.current
  val router = LocalRouter.current
  val identity by app.identity.collectAsState()
  val hosts by app.pairedHosts.collectAsState()
  val connection by app.host.connection.collectAsState()
  val deviceHosts by app.host.deviceHosts.collectAsState()
  val deviceName by app.deviceNameFlow.collectAsState()
  val theme by app.prefs.theme.collectAsState()
  val telemetry by Telemetry.mode.collectAsState()

  LaunchedEffect(connection) { if (connection == Transport.State.Ready) app.host.refreshDeviceHosts() }

  AppScreen("Settings") {
    SettingsPage {
      SettingsGroup {
        SettingsLinkRow("Argus Account", leading = { AccountProfileSummary(app.account, avatarSize = 48.dp) }, showsTitle = false) {
          router.push(Route.Account)
        }
      }

      SettingsGroup(title = "This ${deviceNoun()}") {
        PaneRow(SettingsPane.Name, deviceName)
        PaneRow(SettingsPane.Appearance, theme.label)
        PaneRow(SettingsPane.Alerts)
        PaneRow(SettingsPane.Privacy, if (telemetry == TelemetryMode.Full) "Sharing" else "Minimal")
      }

      identity?.let { computer ->
        SettingsGroup(title = computer.label) {
          PaneRow(SettingsPane.Connection, connection.label)
          PaneRow(SettingsPane.Agents)
          PaneRow(SettingsPane.Automations)
          PaneRow(SettingsPane.Worktrees)
          SettingsLinkRow("Accounts", icon = Icon.person) { router.push(Route.ClaudeAccounts) }
          SettingsLinkRow("Usage", icon = Icon.usage) { router.push(Route.Usage) }
          if (deviceHosts.isNotEmpty()) PaneRow(SettingsPane.DeviceHosts, "${deviceHosts.size}")
        }
      }

      SettingsGroup(footer = "Pair with as many computers as you like; the app talks to one at a time.") {
        if (hosts.isEmpty()) {
          SettingsLinkRow("Pair a Computer", icon = Icon.plus) { router.push(Route.Pair) }
        } else {
          SettingsLinkRow("Computers", icon = Icon.desktop, value = "${hosts.size}") { router.push(Route.Computers) }
        }
      }
    }
  }
}

@Composable
private fun PaneRow(pane: SettingsPane, value: String? = null) {
  val router = LocalRouter.current
  SettingsLinkRow(pane.title, icon = pane.icon, value = value) { router.push(pane.route) }
}

/** One sub-page under its title. */
@Composable
fun SettingsPaneScreen(raw: String) {
  val pane = SettingsPane.of(raw) ?: return
  AppScreen(pane.title) {
    when (pane) {
      SettingsPane.Name -> NameSettingsPage()
      SettingsPane.Appearance -> AppearanceSettingsPage()
      SettingsPane.Alerts -> AlertsSettingsPage()
      SettingsPane.Privacy -> PrivacySettingsPage()
      SettingsPane.Connection -> ConnectionSettingsPage()
      SettingsPane.Agents -> AgentsSettingsPage()
      SettingsPane.Automations -> AutomationsSettingsPage()
      SettingsPane.Worktrees -> WorktreesSettingsPage()
      SettingsPane.DeviceHosts -> DeviceHostsSettingsPage()
    }
  }
}
