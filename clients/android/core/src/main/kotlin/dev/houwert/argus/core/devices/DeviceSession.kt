package dev.houwert.argus.core.devices

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.kit.media.MediaMessage
import dev.houwert.argus.kit.protocol.generated.RemoteDeviceClaim
import dev.houwert.argus.kit.protocol.generated.RemoteDeviceClaimState
import dev.houwert.argus.kit.protocol.generated.RemoteDeviceState
import dev.houwert.argus.kit.protocol.generated.RemotePlatform
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive

/** What [DeviceSession] needs from a host; [HostStore] answers it, tests answer it in memory. */
interface DeviceSessionHost {
  val connectionId: String?
  val deviceClaims: Map<String, RemoteDeviceClaimState>
  suspend fun loadClaimStatus(deviceId: String)
  suspend fun claimDevice(deviceId: String, force: Boolean): Boolean
  suspend fun deviceState(deviceId: String, platform: RemotePlatform): RemoteDeviceState?
}

fun HostStore.asDeviceSessionHost(): DeviceSessionHost = object : DeviceSessionHost {
  private val store = this@asDeviceSessionHost
  override val connectionId get() = store.connectionId.value
  override val deviceClaims get() = store.deviceClaims.value
  override suspend fun loadClaimStatus(deviceId: String) = store.loadClaimStatus(deviceId)
  override suspend fun claimDevice(deviceId: String, force: Boolean) = store.claimDevice(deviceId, force)
  override suspend fun deviceState(deviceId: String, platform: RemotePlatform) = store.deviceState(deviceId, platform)
}

typealias MediaSink = (MediaMessage) -> Unit

/**
 * One screen watching one live device: open the stream (retrying while the
 * device finishes booting), take the claim, seed its pose, and give up on a
 * picture that never arrives.
 */
class DeviceSession(
  private val timing: Timing = Timing(),
  private val sleep: suspend (Duration) -> Unit = { delay(it) },
  private val now: () -> Long = System::currentTimeMillis,
  private val onWatchEnded: (Watch) -> Unit,
) {
  enum class Status { Connecting, Error, NoVideo, Streaming }

  data class Timing(
    /** A device that only just booted refuses capture for a while. */
    val startAttempts: Int = 6,
    val retryDelay: Duration = 5.seconds,
    /** Booted but producing nothing decodable: worth saying so. */
    val noVideoTimeout: Duration = 10.seconds,
  )

  /** One finished look at a device, for telemetry. */
  data class Watch(val platform: RemotePlatform, val durationMs: Long, val interacted: Boolean)

  private val _status = MutableStateFlow(Status.Connecting)
  val status: StateFlow<Status> = _status.asStateFlow()
  /** The stream's own size, zero until its config arrives. */
  private val _codedSize = MutableStateFlow(DSize.Zero)
  val codedSize: StateFlow<DSize> = _codedSize.asStateFlow()

  private var detach: (() -> Unit)? = null
  private var watch: Triple<String, RemotePlatform, Long>? = null
  private var interacted = false

  /** Watch [deviceId] until the calling coroutine is cancelled or [stop]. A rerun on the same device continues its watch. */
  suspend fun run(
    deviceId: String,
    platform: RemotePlatform,
    host: DeviceSessionHost,
    claim: Boolean,
    attach: suspend (MediaSink) -> (() -> Unit)?,
    sink: MediaSink,
  ) {
    detachStream()
    if (watch?.first != deviceId) {
      endWatch()
      watch = Triple(deviceId, platform, now())
      interacted = false
    }
    _status.value = Status.Connecting
    _codedSize.value = DSize.Zero

    val tracked: MediaSink = { message ->
      if (message is MediaMessage.Config) _codedSize.value = DSize(message.codedWidth.toDouble(), message.codedHeight.toDouble())
      sink(message)
    }
    var attached: (() -> Unit)? = null
    for (attempt in 0 until timing.startAttempts) {
      attached = attach(tracked)
      if (attached != null || !active()) break
      if (attempt + 1 < timing.startAttempts) sleep(timing.retryDelay)
    }
    val stop = attached ?: run {
      if (active()) _status.value = Status.Error
      return
    }
    // Superseded while starting: the next run owns the view now.
    if (!active()) return stop()
    detach = stop

    // Take the device unless someone else already drives it; the host pushes `device.claim` from here.
    if (claim) {
      host.loadClaimStatus(deviceId)
      if (otherHolder(host.deviceClaims[deviceId], host.connectionId) == null) host.claimDevice(deviceId, false)
    }
    // Seed the pose; the host pushes `device.state` while it is watched.
    host.deviceState(deviceId, platform)

    sleep(timing.noVideoTimeout)
    if (active() && _status.value == Status.Connecting) _status.value = Status.NoVideo
  }

  /** The first frame is on screen. */
  fun markStreaming() { _status.value = Status.Streaming }

  /** Something was driven from this screen: a glance and a working session are worth telling apart. */
  fun markInteracted() { interacted = true }

  /** Leave the device: drop the stream and report the watch. */
  fun stop() {
    detachStream()
    endWatch()
  }

  private suspend fun active() = currentCoroutineContext().isActive

  private fun detachStream() {
    detach?.invoke()
    detach = null
  }

  private fun endWatch() {
    val (_, platform, start) = watch ?: return
    watch = null
    onWatchEnded(Watch(platform, now() - start, interacted))
  }

  companion object {
    /** Who holds the device when it isn't this connection; nobody until our own id is known. */
    fun otherHolder(claim: RemoteDeviceClaimState?, connectionId: String?): RemoteDeviceClaim? {
      val holder = claim?.holder ?: return null
      connectionId ?: return null
      return if (holder.connectionId == connectionId) null else holder
    }
  }
}
