package dev.houwert.argus.app.screens.terminals

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.LocalRouter
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.screens.AppScreen
import dev.houwert.argus.core.stores.listTerminals
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.RemoteTerminal
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.terminals.SessionTerminalsList
import dev.houwert.argus.ui.terminals.TerminalLabels
import kotlin.time.Duration.Companion.seconds

/** A session's terminals on the computer; a tap reads one's output. */
@Composable
fun TerminalsScreen(route: Route.Terminals) {
  val host = LocalAppStore.current.host
  val router = LocalRouter.current
  val connection by host.connection.collectAsState()
  var terminals by remember(route.sessionId) { mutableStateOf<List<RemoteTerminal>?>(null) }
  LiveRefresh(enabled = connection == Transport.State.Ready, interval = 5.seconds) {
    terminals = host.listTerminals(route.sessionId)
  }
  AppScreen("Terminals · ${route.label}") {
    SessionTerminalsList(terminals, open = { router.push(Route.Terminal(it.id, TerminalLabels.title(it))) })
  }
}
