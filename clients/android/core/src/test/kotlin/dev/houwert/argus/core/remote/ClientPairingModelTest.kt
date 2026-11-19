package dev.houwert.argus.core.remote

import dev.houwert.argus.core.remote.ClientPairingModel.Phase
import dev.houwert.argus.kit.net.PairingClient
import dev.houwert.argus.kit.net.PairingClientInfo
import dev.houwert.argus.kit.net.PairingError
import dev.houwert.argus.kit.storage.DeviceIdentity
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.consumeAsFlow
import kotlinx.coroutines.flow.onCompletion
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Test

class ClientPairingModelTest {
  private val code = """{"v":1,"url":"ws://10.0.0.2:47615","ds_pub":"cHVi","pairing_secret":"c2VjcmV0"}"""
  private val info = PairingClientInfo(product = "Argus", kind = "mobile", device = "Pixel")
  private val identity = DeviceIdentity(
    deviceId = "d1", devPrivB64 = "", devPubB64 = "", desktopPubB64 = "", url = "ws://10.0.0.2:47615",
    capabilities = listOf("monitor", "control"),
  )

  private class Harness(scope: TestScope, info: PairingClientInfo) {
    val events = Channel<PairingClient.Event>(Channel.UNLIMITED)
    var connects = 0
    var closed = false
    val paired = mutableListOf<DeviceIdentity>()
    val failures = mutableListOf<PairingError>()
    val model = ClientPairingModel(
      scope = scope.backgroundScope,
      client = info,
      onPaired = { paired += it },
      onFailed = { failures += it },
      connect = { _, client ->
        connects++
        assertEquals("mobile", client.kind)
        events.consumeAsFlow().onCompletion { closed = true }
      },
    )
  }

  @Test fun walksFromCodeToSasToPaired() = runTest {
    val h = Harness(this, info)
    h.model.begin(code)
    runCurrent()
    h.events.send(PairingClient.Event.Sas("123456"))
    runCurrent()
    assertEquals(Phase.AwaitingConfirmation("123456"), h.model.state.value.phase)

    h.events.send(PairingClient.Event.Paired(identity))
    h.events.close()
    runCurrent()
    assertEquals(Phase.Paired, h.model.state.value.phase)
    assertEquals(listOf(identity), h.paired)
  }

  @Test fun anInvalidCodeNeverDials() = runTest {
    val h = Harness(this, info)
    h.model.begin("not a code")
    runCurrent()
    assertEquals(0, h.connects)
    assertEquals(listOf(PairingError.InvalidCode), h.failures)
    assertEquals(ClientPairingModel.message(PairingError.InvalidCode), h.model.state.value.error)
  }

  @Test fun aFailureReturnsToScanningAndAllowsAnotherTry() = runTest {
    val h = Harness(this, info)
    h.model.begin(code)
    runCurrent()
    h.events.send(PairingClient.Event.Failed(PairingError.HandshakeFailed))
    h.events.close()
    runCurrent()
    assertEquals(Phase.Scan, h.model.state.value.phase)
    assertEquals(listOf(PairingError.HandshakeFailed), h.failures)
    assertEquals("handshakeFailed", PairingError.HandshakeFailed.telemetryReason)

    h.model.begin(code)
    runCurrent()
    assertEquals(2, h.connects)
    assertNull(h.model.state.value.error)
  }

  @Test fun aSecondCodeWhilePairingIsIgnored() = runTest {
    val h = Harness(this, info)
    h.model.begin(code)
    h.model.begin(code)
    runCurrent()
    assertEquals(1, h.connects)
  }

  @Test fun cancellingClosesTheConnectionAndGoesBackToScanning() = runTest {
    val h = Harness(this, info)
    h.model.begin(code)
    runCurrent()
    h.events.send(PairingClient.Event.Sas("123456"))
    runCurrent()
    h.model.cancel()
    runCurrent()
    assertTrue(h.closed)
    assertEquals(Phase.Scan, h.model.state.value.phase)
  }
}
