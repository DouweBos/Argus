package dev.houwert.argus.app.screens.automations

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import androidx.navigation.NavBackStackEntry
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Router
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.ui.icons.Icon
import dev.houwert.argus.ui.theme.ArgusTheme

/**
 * An automations screen under its top app bar: the title, a back arrow when pushed (a tab's
 * root has none), and trailing [actions].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AutomationsScaffold(title: String, actions: @Composable RowScope.() -> Unit = {}, content: @Composable () -> Unit) {
  val theme = ArgusTheme.colors
  val router = LocalRouter.current
  val entry = LocalViewModelStoreOwner.current as? NavBackStackEntry
  val pushed = entry != null && entry.destination.route != Router.ROOT
  Column(Modifier.fillMaxSize().background(theme.bg)) {
    TopAppBar(
      title = { Text(title, style = ArgusTheme.typography.headline, maxLines = 1, overflow = TextOverflow.Ellipsis) },
      navigationIcon = { if (pushed) IconButton(router::pop) { Icon(Icon.arrowBack, "Back") } },
      actions = actions,
      colors = TopAppBarDefaults.topAppBarColors(
        containerColor = theme.bg,
        titleContentColor = theme.text,
        navigationIconContentColor = theme.text,
        actionIconContentColor = theme.textSecondary,
      ),
      // The app scaffold already pads for the status bar.
      windowInsets = WindowInsets(0, 0, 0, 0),
    )
    Box(Modifier.weight(1f)) { content() }
  }
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
