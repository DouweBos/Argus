package dev.houwert.argus.app.screens.automations

import androidx.compose.foundation.layout.RowScope
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.app.screens.AppScreen

/**
 * An automations screen under its top app bar: the title, a back arrow when pushed (a tab's
 * root has none), and trailing [actions].
 */
@Composable
internal fun AutomationsScaffold(title: String, actions: @Composable RowScope.() -> Unit = {}, content: @Composable () -> Unit) {
  AppScreen(title, actions, content)
}

/** A text action in the app bar, as iOS's confirmation toolbar items. */
@Composable
internal fun BarTextAction(label: String, enabled: Boolean = true, onClick: () -> Unit) {
  TextButton(onClick, enabled = enabled) {
    Text(label, color = if (enabled) ArgusTheme.colors.accent else ArgusTheme.colors.textMuted, style = ArgusTheme.typography.headline)
  }
}

/** The connection and this device's grant: what every automations screen gates its actions on. */
internal data class HostAccess(val ready: Boolean, val hasControl: Boolean)

@Composable
internal fun rememberHostAccess(): HostAccess {
  val host = LocalAppStore.current.host
  val connection by host.connection.collectAsState()
  val capabilities by host.capabilities.collectAsState()
  return HostAccess(connection == Transport.State.Ready, "control" in capabilities)
}
