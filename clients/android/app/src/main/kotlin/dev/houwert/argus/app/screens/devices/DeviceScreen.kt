package dev.houwert.argus.app.screens.devices

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import dev.houwert.argus.app.LocalAppStore
import dev.houwert.argus.app.navigation.Route
import dev.houwert.argus.app.screens.AppScreen
import dev.houwert.argus.core.devices.DPoint
import dev.houwert.argus.core.devices.DSize
import dev.houwert.argus.core.devices.DeviceGeometry
import dev.houwert.argus.core.devices.DeviceSession
import dev.houwert.argus.core.devices.EasBilling
import dev.houwert.argus.core.devices.RuntimeStreamHub
import dev.houwert.argus.core.devices.asDeviceSessionHost
import dev.houwert.argus.core.devices.claimDevice
import dev.houwert.argus.core.devices.deviceButton
import dev.houwert.argus.core.devices.deviceKeyboard
import dev.houwert.argus.core.devices.deviceTouch
import dev.houwert.argus.core.devices.rotation
import dev.houwert.argus.core.devices.setDeviceFold
import dev.houwert.argus.core.devices.setDeviceOrientation
import dev.houwert.argus.core.devices.stopEasSession
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.RemotePlatform
import dev.houwert.argus.kit.util.KeyMap
import dev.houwert.argus.ui.components.Banner
import dev.houwert.argus.ui.components.ControlRequiredBanner
import dev.houwert.argus.ui.devices.DeviceVideoHandle
import dev.houwert.argus.ui.devices.DeviceVideoView
import dev.houwert.argus.ui.devices.TVRemoteView
import dev.houwert.argus.ui.theme.ArgusMetrics
import dev.houwert.argus.ui.theme.ArgusTheme
import dev.houwert.argus.ui.theme.Tone
import kotlinx.coroutines.launch

/** A live mirrored device: H.264 in, touches and keystrokes back out. */
@Composable
fun DeviceScreen(route: Route.Device) {
  val host = LocalAppStore.current.host
  val theme = ArgusTheme.colors
  val scope = rememberCoroutineScope()
  val platform = RemotePlatform(route.platform)
  val connection by host.connection.collectAsState()
  val capabilities by host.capabilities.collectAsState()
  val hasControl = "control" in capabilities
  val states by host.deviceStates.collectAsState()
  val claims by host.deviceClaims.collectAsState()
  val connectionId by host.connectionId.collectAsState()

  val handle = remember { DeviceVideoHandle() }
  val session = remember { DeviceSession(onWatchEnded = {}) }
  val hub = remember(host) { RuntimeStreamHub(host) }
  val status by session.status.collectAsState()
  val coded by session.codedSize.collectAsState()
  var confirmingEnd by remember { mutableStateOf(false) }
  var busy by remember { mutableStateOf(false) }

  // The host's own reading: the hinge and orientation move from the desktop or an agent too.
  val deviceState = states[route.id]
  val otherHolder = DeviceSession.otherHolder(claims[route.id], connectionId)
  val isEas = EasBilling.isEas(route.id)

  LaunchedEffect(connection) {
    if (connection != Transport.State.Ready) return@LaunchedEffect
    session.run(
      route.id, platform, host.asDeviceSessionHost(), claim = hasControl,
      attach = { sink -> hub.attach(RuntimeStreamHub.Subject.Device(route.id, platform), sink) },
      sink = handle::receive,
    )
  }
  DisposableEffect(Unit) {
    onDispose {
      session.stop()
      handle.release()
    }
  }

  val press: (String) -> Unit = { button ->
    session.markInteracted()
    host.deviceButton(route.id, platform, button)
  }

  AppScreen(route.name) {
    Column(Modifier.fillMaxSize().background(theme.bg)) {
      Stage(
        handle, session, status, DeviceGeometry(coded, DSize.Zero, deviceState?.rotation ?: 0.0),
        touchEnabled = hasControl && !route.isTv,
        onTouch = { point, phase ->
          session.markInteracted()
          host.deviceTouch(route.id, platform, point.x, point.y, phase)
        },
        modifier = Modifier.weight(1f),
      )
      when {
        !hasControl -> ControlRequiredBanner("tap and type here", Modifier.padding(ArgusMetrics.space))
        // Input would be refused outright, so say who has it and offer to take it.
        otherHolder != null -> Banner(
          "${otherHolder.label} is controlling this device.", Modifier.padding(ArgusMetrics.space), tone = Tone.Warning,
          actionLabel = "Take control", onAction = { scope.launch { host.claimDevice(route.id, force = true) } },
        )
        route.isTv -> HardwareKeyCatcher(press) {
          TVRemoteView(press, isAndroid = platform == RemotePlatform.android, modifier = Modifier.fillMaxWidth())
        }
        else -> DeviceButtonBar(
          platform = platform, isEas = isEas, fold = deviceState?.fold, orientation = deviceState?.orientation, busy = busy,
          onButton = press,
          onKey = { sendKey(host, session, route.id, platform, it) },
          onEndSession = { confirmingEnd = true },
          onRotate = { next -> busy = true; scope.launch { host.setDeviceOrientation(route.id, platform, next); busy = false } },
          onFold = { pose -> busy = true; scope.launch { host.setDeviceFold(route.id, platform, pose); busy = false } },
        )
      }
    }
  }

  if (confirmingEnd) {
    AlertDialog(
      onDismissRequest = { confirmingEnd = false },
      title = { Text("End this EAS Simulator session?") },
      text = { Text("The cloud device goes away and stops billing.") },
      confirmButton = {
        TextButton({
          confirmingEnd = false
          busy = true
          scope.launch {
            runCatching { host.stopEasSession(route.id) }
            busy = false
          }
        }) { Text("End session", color = theme.error) }
      },
      dismissButton = { TextButton({ confirmingEnd = false }) { Text("Cancel") } },
    )
  }
}

/** The picture, sized in the stream's own axes and then turned, plus the touch surface. */
@Composable
private fun Stage(
  handle: DeviceVideoHandle,
  session: DeviceSession,
  status: DeviceSession.Status,
  geometryWithoutStage: DeviceGeometry,
  touchEnabled: Boolean,
  onTouch: (DPoint, Int) -> Unit,
  modifier: Modifier,
) {
  val theme = ArgusTheme.colors
  val density = LocalDensity.current
  var stage by remember { mutableStateOf(IntSize.Zero) }
  val geometry = geometryWithoutStage.copy(stage = DSize(stage.width.toDouble(), stage.height.toDouble()))
  val latestGeometry by rememberUpdatedState(geometry)
  val latestTouch by rememberUpdatedState(onTouch)

  Box(
    modifier
      .fillMaxWidth()
      .background(theme.mediaBg)
      .onSizeChanged { stage = it }
      // A TV is driven by the remote below; a tap on its picture is nothing.
      .pointerInput(touchEnabled) {
        if (!touchEnabled) return@pointerInput
        // Throttle by distance travelled rather than a clock: it tracks what the far end must redraw.
        val minTravel = 2.dp.toPx()
        fun send(position: Offset, phase: Int) {
          latestGeometry.normalize(DPoint(position.x.toDouble(), position.y.toDouble()))?.let { latestTouch(it, phase) }
        }
        awaitEachGesture {
          val down = awaitFirstDown()
          down.consume()
          var last = down.position
          var end = last
          send(last, 0)
          while (true) {
            val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id } ?: break
            end = change.position
            if (!change.pressed) break
            change.consume()
            if ((change.position - last).getDistance() >= minTravel) {
              last = change.position
              send(last, 1)
            }
          }
          send(end, 2)
        }
      },
    contentAlignment = Alignment.Center,
  ) {
    val rendered = geometry.renderedSize
    with(density) {
      DeviceVideoView(
        handle,
        Modifier.size(rendered.width.toFloat().toDp(), rendered.height.toFloat().toDp())
          .graphicsLayer { rotationZ = geometry.rotation.toFloat() },
        onFirstFrame = session::markStreaming,
      )
    }
    if (status != DeviceSession.Status.Streaming) {
      Text(
        placeholder(status), Modifier.padding(ArgusMetrics.space), color = theme.textMuted,
        style = ArgusTheme.typography.footnote, textAlign = TextAlign.Center,
      )
    }
  }
}

private fun placeholder(status: DeviceSession.Status) = when (status) {
  DeviceSession.Status.Connecting -> "Connecting to device"
  DeviceSession.Status.Error -> "Couldn't start the stream. Is the device still booted?"
  DeviceSession.Status.NoVideo -> "No video from this device. It's booted but not producing a stream."
  DeviceSession.Status.Streaming -> ""
}

/** One character, or `Backspace` / `Enter`, as a key down and up. */
private fun sendKey(host: HostStore, session: DeviceSession, deviceId: String, platform: RemotePlatform, character: String) {
  val key = KeyMap.nativeKey(platform, character) ?: return
  session.markInteracted()
  host.deviceKeyboard(deviceId, platform, key.keyCode, key.modifiers, true)
  host.deviceKeyboard(deviceId, platform, key.keyCode, key.modifiers, false)
}
