package dev.houwert.argus.app.screens.design

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.core.stores.DesignCompareTarget
import dev.houwert.argus.core.stores.DesignViewerModel
import dev.houwert.argus.core.stores.loadedSession
import dev.houwert.argus.core.stores.refreshDevices
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.RemotePlatform
import dev.houwert.argus.ui.design.DesignViewerView
import dev.houwert.argus.ui.theme.ArgusTheme
import kotlinx.coroutines.launch
import dev.houwert.argus.ui.components.TitleBar
import dev.houwert.argus.app.screens.backAction

/**
 * A Figma frame in the shared design viewer, as the Mac's `/design`. Opened for a session, it
 * flags a design that moved on and compares against the computer's running simulators and emulators.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DesignScreen(url: String, sessionId: String?) {
  val host = LocalAppStore.current.host
  val session = remember(sessionId) { sessionId?.let(host::loadedSession) }
  val model = remember(url, host) {
    DesignViewerModel(url, session?.let { DesignViewerModel.sessionVersion(url, it) }, host)
  }
  val scope = rememberCoroutineScope()
  val details by model.details.collectAsState()
  val connection by host.connection.collectAsState()
  val devices by host.devices.collectAsState()
  var refreshing by remember { mutableStateOf(false) }
  val forSession = session != null

  LaunchedEffect(forSession, connection) {
    if (forSession && connection == Transport.State.Ready) host.refreshDevices()
  }
  // The computer's own running simulators and emulators: the ones it can screenshot.
  val targets = if (!forSession) null else devices
    .filter { it.booted && it.deviceHostLabel == null && !it.isTv }
    .map { DesignCompareTarget(RemotePlatform(it.platform.rawValue), it.id, it.name) }

  Column(Modifier.fillMaxSize().background(ArgusTheme.colors.bg)) {
    TitleBar(details?.frame?.name ?: "Design", onBack = backAction())
    PullToRefreshBox(
      refreshing,
      {
        scope.launch {
          refreshing = true
          model.load()
          refreshing = false
        }
      },
      Modifier.fillMaxWidth().weight(1f),
    ) {
      DesignViewerView(model, compareTargets = targets, compareHint = "Boot a simulator or emulator on the computer to compare against it.")
    }
  }
}
