package dev.houwert.argus.app.screens.terminals

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.screens.AppScreen
import dev.houwert.argus.core.stores.followTerminal
import dev.houwert.argus.core.stores.readTerminal
import dev.houwert.argus.core.terminals.TerminalFeed
import dev.houwert.argus.core.terminals.TerminalText
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.ui.components.LiveRefresh
import dev.houwert.argus.ui.terminals.TerminalOutputState
import dev.houwert.argus.ui.terminals.TerminalOutputView
import kotlin.time.Duration.Companion.seconds

/**
 * One terminal's output, following the tail as it grows. Streams when the
 * computer can; an older one is polled every two seconds instead.
 */
@Composable
fun TerminalScreen(route: Route.Terminal) {
  val host = LocalAppStore.current.host
  val connection by host.connection.collectAsState()
  val ready = connection == Transport.State.Ready
  val buffer = remember(route.id) { TerminalText() }
  var state by remember(route.id) { mutableStateOf(TerminalOutputState()) }
  var streaming by remember(route.id) { mutableStateOf(false) }
  var stop by remember(route.id) { mutableStateOf<(() -> Unit)?>(null) }

  fun apply(outputs: List<TerminalFeed.Output>) {
    var exit = state.exitCode
    for (item in outputs) {
      when (item) {
        TerminalFeed.Output.Reset -> { buffer.reset(); exit = null }
        is TerminalFeed.Output.Data -> buffer.append(item.bytes)
        is TerminalFeed.Output.Exit -> exit = item.code
      }
    }
    state = state.copy(text = buffer.text, truncated = buffer.truncated, exitCode = exit)
  }

  // A dropped connection loses its subscription, so a reconnect follows again.
  LaunchedEffect(route.id, ready) {
    stop?.invoke()
    stop = null
    streaming = false
    if (!ready || state.gone) return@LaunchedEffect
    val follow = host.followTerminal(route.id, ::apply)
    stop = follow
    streaming = follow != null
  }
  DisposableEffect(route.id) { onDispose { stop?.invoke() } }

  LiveRefresh(enabled = ready && !streaming && !state.gone, interval = 2.seconds) {
    val next = host.readTerminal(route.id)
    if (next != null) {
      buffer.reset()
      buffer.append(next.output.toByteArray())
      buffer.truncated = next.truncated
      state = state.copy(
        text = buffer.text,
        truncated = next.truncated,
        exitCode = if (next.running) null else (next.exitCode ?: 0.0).toInt(),
      )
    } else if (state.text.isNotEmpty() || state.exitCode != null) {
      state = state.copy(gone = true)
    }
  }

  AppScreen(route.label) { TerminalOutputView(state) }
}
