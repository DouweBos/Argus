package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.net.TransportException
import dev.houwert.argus.kit.protocol.GatewayErrorPayload
import java.net.SocketException
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.test.runTest
import org.junit.Test

class BackgroundRefreshTest {
  private val refused = TransportException.Gateway(GatewayErrorPayload("x", "no"))

  @Test fun aLostConnectionIsTransientARefusedRequestIsNot() {
    assertTrue(HostStore.isTransient(TransportException.NotReady()))
    assertTrue(HostStore.isTransient(TransportException.TimedOut()))
    assertTrue(HostStore.isTransient(SocketException("Connection reset")))
    assertFalse(HostStore.isTransient(refused))
    assertFalse(HostStore.isTransient(IllegalArgumentException("bad url")))
  }

  @Test fun onlyABackgroundRefreshKeepsALostConnectionQuiet() = runTest {
    assertFalse(HostStore.isQuiet(TransportException.NotReady()))
    assertTrue(HostStore.isQuiet(CancellationException()))
    BackgroundRefresh.run {
      assertTrue(HostStore.isQuiet(TransportException.NotReady()))
      assertTrue(HostStore.isQuiet(TransportException.TimedOut()))
      assertFalse(HostStore.isQuiet(refused))
      // Coroutines a refresh starts inherit it.
      val inherited = coroutineScope { async { HostStore.isQuiet(TransportException.NotReady()) }.await() }
      assertTrue(inherited)
    }
    assertFalse(BackgroundRefresh.isActive)
  }

  @Test fun pollsThatHitADroppedConnectionReportNothing() = runTest {
    val reported = mutableListOf<String>()
    val host = HostStore(backgroundScope, HostStoreHooks(errorReported = { _, scope -> reported += scope }))
    BackgroundRefresh.run { host.report(TransportException.NotReady()) }
    assertTrue(reported.isEmpty())
    assertNull(host.lastError.value)
  }

  @Test fun whatTheUserAskedForStillSurfacesALostConnection() = runTest {
    val reported = mutableListOf<String>()
    val host = HostStore(backgroundScope, HostStoreHooks(errorReported = { _, scope -> reported += scope }))
    host.report(TransportException.TimedOut())
    assertEquals(listOf("app"), reported)
    assertEquals("The computer didn't answer in time.", host.lastError.value)
  }
}
