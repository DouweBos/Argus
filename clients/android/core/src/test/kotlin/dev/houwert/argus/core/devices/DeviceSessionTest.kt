package dev.houwert.argus.core.devices

import dev.houwert.argus.kit.media.MediaMessage
import dev.houwert.argus.kit.protocol.generated.RemoteDeviceClaim
import dev.houwert.argus.kit.protocol.generated.RemoteDeviceClaimState
import dev.houwert.argus.kit.protocol.generated.RemoteDeviceState
import dev.houwert.argus.kit.protocol.generated.RemotePlatform
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.test.runTest
import org.junit.Test

private class FakeDeviceHost : DeviceSessionHost {
  override var connectionId: String? = null
  override val deviceClaims = mutableMapOf<String, RemoteDeviceClaimState>()
  var statusHolder: RemoteDeviceClaim? = null
  val calls = mutableListOf<String>()

  override suspend fun loadClaimStatus(deviceId: String) {
    calls += "status"
    connectionId = "me"
    deviceClaims[deviceId] = RemoteDeviceClaimState(deviceId, statusHolder, emptyList())
  }

  override suspend fun claimDevice(deviceId: String, force: Boolean): Boolean {
    calls += if (force) "claim!" else "claim"
    return true
  }

  override suspend fun deviceState(deviceId: String, platform: RemotePlatform): RemoteDeviceState? {
    calls += "state"
    return null
  }
}

private fun claim(connection: String) = RemoteDeviceClaim(connection, "d", connection)

class DeviceSessionTest {
  private val slept = mutableListOf<Duration>()

  private fun session(watches: (DeviceSession.Watch) -> Unit = {}) =
    DeviceSession(sleep = { slept += it }, onWatchEnded = watches)

  @Test fun retriesARefusedStartFiveSecondsApartThenClaimsAndSeedsThePose() = runTest {
    val host = FakeDeviceHost()
    val session = session()
    var attempts = 0
    session.run("d", RemotePlatform.ios, host, claim = true, attach = { attempts += 1; if (attempts < 3) null else ({}) }, sink = {})
    assertEquals(3, attempts)
    assertEquals(listOf(5.seconds, 5.seconds, 10.seconds), slept)
    assertEquals(listOf("status", "claim", "state"), host.calls)
    assertEquals(DeviceSession.Status.NoVideo, session.status.value)
  }

  @Test fun givesUpAfterSixRefusedStarts() = runTest {
    val session = session()
    var attempts = 0
    session.run("d", RemotePlatform.ios, FakeDeviceHost(), claim = true, attach = { attempts += 1; null }, sink = {})
    assertEquals(6, attempts)
    assertEquals(5, slept.size)
    assertEquals(DeviceSession.Status.Error, session.status.value)
  }

  @Test fun leavesSomeoneElsesClaimAloneAndClaimsNothingWithoutControl() = runTest {
    val held = FakeDeviceHost().apply { statusHolder = claim("other") }
    session().run("d", RemotePlatform.ios, held, claim = true, attach = { {} }, sink = {})
    assertEquals(listOf("status", "state"), held.calls)

    val watcher = FakeDeviceHost()
    session().run("d", RemotePlatform.ios, watcher, claim = false, attach = { {} }, sink = {})
    assertEquals(listOf("state"), watcher.calls)
  }

  @Test fun tracksTheCodedSizeAndKeepsAStreamingPictureOutOfNoVideo() = runTest {
    val session = session()
    var forwarded = 0
    session.run("d", RemotePlatform.ios, FakeDeviceHost(), claim = false, attach = { sink ->
      sink(MediaMessage.Config(1, "avc1", 300, 600, byteArrayOf()))
      session.markStreaming()
      ({})
    }, sink = { forwarded += 1 })
    assertEquals(DSize(300.0, 600.0), session.codedSize.value)
    assertEquals(1, forwarded)
    assertEquals(DeviceSession.Status.Streaming, session.status.value)
  }

  @Test fun someoneElseHoldsItOnlyOnceOurOwnConnectionIdIsKnown() {
    val state = RemoteDeviceClaimState("d", claim("other"), emptyList())
    assertNull(DeviceSession.otherHolder(state, null))
    assertNull(DeviceSession.otherHolder(state, "other"))
    assertEquals(claim("other"), DeviceSession.otherHolder(state, "me"))
    assertNull(DeviceSession.otherHolder(null, "me"))
  }

  @Test fun aRerunOnTheSameDeviceKeepsTheWatchAndStopReportsItOnce() = runTest {
    val watches = mutableListOf<DeviceSession.Watch>()
    var detached = 0
    val session = session { watches += it }
    val attach: suspend (MediaSink) -> (() -> Unit)? = { { detached += 1 } }
    session.run("d", RemotePlatform.android, FakeDeviceHost(), claim = false, attach = attach, sink = {})
    session.markInteracted()
    session.run("d", RemotePlatform.android, FakeDeviceHost(), claim = false, attach = attach, sink = {})
    assertEquals(1, detached)
    assertTrue(watches.isEmpty())
    session.stop()
    session.stop()
    assertEquals(2, detached)
    assertEquals(listOf(RemotePlatform.android), watches.map { it.platform })
    assertEquals(listOf(true), watches.map { it.interacted })
  }
}
