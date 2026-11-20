package dev.houwert.argus.core.devices

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.refreshDeviceHosts
import dev.houwert.argus.core.stores.refreshDevices
import dev.houwert.argus.kit.media.MediaMessage
import dev.houwert.argus.kit.protocol.generated.Methods
import dev.houwert.argus.kit.protocol.generated.MethodsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteDeviceClaimState
import dev.houwert.argus.kit.protocol.generated.RemoteDeviceOrientation
import dev.houwert.argus.kit.protocol.generated.RemoteDevicePlatform
import dev.houwert.argus.kit.protocol.generated.RemoteDeviceState
import dev.houwert.argus.kit.protocol.generated.RemoteFoldPose
import dev.houwert.argus.kit.protocol.generated.RemotePlatform
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonPrimitive

// Mirrored devices: watching, input injection and who holds each one.

val RemoteDevicePlatform.platform: RemotePlatform get() = RemotePlatform(rawValue)

/** The order the rotate button walks, matching the desktop's. */
val RemoteDeviceOrientation.next: RemoteDeviceOrientation get() = when (this) {
  RemoteDeviceOrientation.portrait -> RemoteDeviceOrientation.landscapeLeft
  RemoteDeviceOrientation.landscapeLeft -> RemoteDeviceOrientation.portraitUpsideDown
  RemoteDeviceOrientation.portraitUpsideDown -> RemoteDeviceOrientation.landscapeRight
  else -> RemoteDeviceOrientation.portrait
}

/** Clockwise degrees the stream is turned to sit upright; 0 when unknown. */
val RemoteDeviceState.rotation: Double
  get() = runCatching { display?.rotation?.jsonPrimitive?.doubleOrNull }.getOrNull() ?: 0.0

/** Receive [streamId]'s parsed frames, including any buffered before this call. Returns a remover. */
fun HostStore.registerMediaSink(streamId: Int, sink: (MediaMessage) -> Unit): () -> Unit =
  mediaRouter.register(streamId, sink)

suspend fun HostStore.watchDevice(deviceId: String, platform: RemotePlatform): Int? {
  val backend = backend ?: return null
  return runCatching { backend.request(Methods.DevicesWatch, MethodsTypes.DevicesWatchParams(deviceId, platform)) }
    .getOrNull()?.let { (it.streamId and 0xFFFF).toInt() }
}

suspend fun HostStore.unwatchDevice(deviceId: String) {
  val backend = backend ?: return
  runCatching { backend.request(Methods.DevicesUnwatch, MethodsTypes.DevicesUnwatchParams(deviceId)) }
}

/** The session's embedded browser as JPEG media frames. */
suspend fun HostStore.watchBrowser(sessionId: String): Int? {
  val backend = backend ?: return null
  return runCatching { backend.request(Methods.BrowserWatch, MethodsTypes.BrowserWatchParams(sessionId)) }
    .getOrNull()?.let { (it.streamId and 0xFFFF).toInt() }
}

suspend fun HostStore.unwatchBrowser(sessionId: String) {
  val backend = backend ?: return
  runCatching { backend.request(Methods.BrowserUnwatch, MethodsTypes.BrowserUnwatchParams(sessionId)) }
}

/** How the device is held, recorded in `deviceStates`. Null on Android, which rotates its own framebuffer. */
suspend fun HostStore.deviceState(deviceId: String, platform: RemotePlatform): RemoteDeviceState? {
  val backend = backend ?: return null
  val state = runCatching { backend.request(Methods.DevicesState, MethodsTypes.DevicesStateParams(deviceId, platform)) }
    .getOrNull()?.state ?: return null
  _deviceStates.update { it + (deviceId to state) }
  return state
}

suspend fun HostStore.setDeviceOrientation(
  deviceId: String, platform: RemotePlatform, orientation: RemoteDeviceOrientation,
): RemoteDeviceState? {
  val backend = backend ?: return null
  return runCatching {
    backend.request(Methods.DevicesSetOrientation, MethodsTypes.DevicesSetOrientationParams(deviceId, platform, orientation))
  }.getOrNull()?.state
}

suspend fun HostStore.setDeviceFold(deviceId: String, platform: RemotePlatform, pose: RemoteFoldPose): RemoteDeviceState? {
  val backend = backend ?: return null
  return runCatching {
    backend.request(Methods.DevicesSetFold, MethodsTypes.DevicesSetFoldParams(deviceId, platform, JsonPrimitive(pose.rawValue)))
  }.getOrNull()?.state
}

/** Returns at once: a touch that waits for a round trip feels broken. Only moves coalesce. */
fun HostStore.deviceTouch(deviceId: String, platform: RemotePlatform, x: Double, y: Double, eventType: Int) {
  val backend = backend ?: return
  val params = MethodsTypes.DevicesTouchParams(
    deviceId, platform, JsonPrimitive(x.coerceIn(0.0, 0.9999)), JsonPrimitive(y.coerceIn(0.0, 0.9999)), JsonPrimitive(eventType),
  )
  deviceInput.enqueue(
    DeviceInputQueue.Item(if (eventType == 1) "move:$deviceId" else null) {
      runCatching { backend.request(Methods.DevicesTouch, params) }
    },
  )
}

fun HostStore.deviceButton(deviceId: String, platform: RemotePlatform, button: String) {
  val backend = backend ?: return
  val params = MethodsTypes.DevicesButtonParams(deviceId, platform, button)
  deviceInput.enqueue(DeviceInputQueue.Item { runCatching { backend.request(Methods.DevicesButton, params) } })
}

fun HostStore.deviceKeyboard(deviceId: String, platform: RemotePlatform, keyCode: Int, modifiers: Int, isDown: Boolean) {
  val backend = backend ?: return
  val params = MethodsTypes.DevicesKeyboardParams(deviceId, platform, keyCode.toDouble(), modifiers.toDouble(), isDown)
  deviceInput.enqueue(DeviceInputQueue.Item { runCatching { backend.request(Methods.DevicesKeyboard, params) } })
}

// Device claims: two clients may watch one screen, but only one drives it, so the host arbitrates.

/** Take the device; [force] steals it from whoever holds it. */
suspend fun HostStore.claimDevice(deviceId: String, force: Boolean = false): Boolean {
  val backend = backend ?: return false
  val result = runCatching { backend.request(Methods.DevicesClaim, MethodsTypes.DevicesClaimParams(deviceId, force)) }
    .getOrNull() ?: return false
  _deviceClaims.update { it + (deviceId to RemoteDeviceClaimState(deviceId, result.holder, emptyList())) }
  return result.granted
}

suspend fun HostStore.releaseDevice(deviceId: String) {
  val backend = backend ?: return
  runCatching { backend.request(Methods.DevicesRelease, MethodsTypes.DevicesReleaseParams(deviceId)) }
  _deviceClaims.update { it - deviceId }
}

/** Who holds the device, and this connection's own id, which the host reports nowhere else. */
suspend fun HostStore.loadClaimStatus(deviceId: String) {
  val backend = backend ?: return
  val result = runCatching { backend.request(Methods.DevicesClaimStatus, MethodsTypes.DevicesClaimStatusParams(deviceId)) }
    .getOrNull() ?: return
  _connectionId.value = result.connectionId
  _deviceClaims.update { it + (deviceId to RemoteDeviceClaimState(deviceId, result.holder, emptyList())) }
}

/** Start a billed EAS Simulator session; the device turns up in `devices` once ready. */
suspend fun HostStore.startEasSession(hostId: String): String {
  val backend = backend ?: throw HostStore.offlineError
  val result = backend.request(Methods.DeviceHostsStartEasSession, MethodsTypes.DeviceHostsStartEasSessionParams(hostId))
  refreshDeviceHosts()
  return result.deviceId
}

/** Stop an EAS Simulator session, which ends its device. */
suspend fun HostStore.stopEasSession(deviceId: String) {
  val backend = backend ?: throw HostStore.offlineError
  backend.request(Methods.DeviceHostsStopEasSession, MethodsTypes.DeviceHostsStopEasSessionParams(deviceId))
  refreshDeviceHosts()
  refreshDevices()
}
