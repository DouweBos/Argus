package dev.houwert.argus.core.hosts

import dev.houwert.argus.kit.net.EndpointRacer
import dev.houwert.argus.kit.net.NetworkPathWatcher
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.storage.DeviceIdentity
import dev.houwert.argus.kit.storage.RemoteEndpoint
import java.time.Instant
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Test

class RouteSupervisorTest {
  private val lan = RemoteEndpoint(RemoteEndpoint.Kind.Lan, "ws://192.168.1.20:47615", 0)
  private val tunnel = RemoteEndpoint(RemoteEndpoint.Kind.Cloudflare, "wss://argus-abc.houwert.dev", 2)
  private val identity = DeviceIdentity(
    deviceId = "d1", devPrivB64 = "", devPubB64 = "", desktopPubB64 = "",
    url = tunnel.url, endpoints = listOf(lan, tunnel), capabilities = listOf("monitor"),
  )

  private class FakePaths : NetworkPathWatcher {
    var onChange: (() -> Unit)? = null
    var stopped = false
    override fun start(onChange: () -> Unit) { this.onChange = onChange }
    override fun stop() { stopped = true }
    fun change() = onChange?.invoke()
  }

  private class Harness(scope: CoroutineScope, test: TestScope, identity: DeviceIdentity, val reachable: Set<String>) {
    val paths = FakePaths()
    val preflights = mutableListOf<List<String>>()
    val adopted = mutableListOf<Pair<String, Boolean>>()
    var busy = false
    var networkChanges = 0
    val supervisor = RouteSupervisor(
      hooks = RouteSupervisor.Hooks(
        identity = { identity },
        busy = { busy },
        adopt = { attempt, upgrade -> adopted += attempt.url to upgrade; true },
        networkChanged = { networkChanges++ },
      ),
      paths = paths,
      scope = scope,
      clock = { Instant.ofEpochMilli(test.testScheduler.currentTime) },
      preflight = { id, candidates ->
        preflights += candidates.map { it.url }
        candidates.firstOrNull { it.url in reachable }?.let { EndpointRacer.Attempt(Transport(id, it.url), it) }
      },
    )
  }

  @Test fun aNetworkChangeUpgradesOnceItSettles() = runTest {
    val h = Harness(backgroundScope, this, identity, reachable = setOf(lan.url))
    h.supervisor.connected(tunnel)
    h.paths.change()
    runCurrent()
    assertEquals(1, h.networkChanges)
    assertTrue(h.preflights.isEmpty())
    advanceTimeBy(RouteSupervisor.SETTLE.inWholeMilliseconds + 1)
    assertEquals(listOf(listOf(lan.url)), h.preflights)
    assertEquals(listOf(lan.url to true), h.adopted)
    assertEquals(lan, h.supervisor.route)
  }

  @Test fun busyConnectionsAreNotSwitched() = runTest {
    val h = Harness(backgroundScope, this, identity, reachable = setOf(lan.url))
    h.busy = true
    h.supervisor.connected(tunnel)
    h.supervisor.recheck()
    advanceTimeBy(RouteSupervisor.SETTLE.inWholeMilliseconds + 1)
    assertTrue(h.preflights.isEmpty())
    assertEquals(tunnel, h.supervisor.route)
  }

  @Test fun nothingIsCheckedWhileTheOwnerConnects() = runTest {
    val h = Harness(backgroundScope, this, identity, reachable = setOf(lan.url))
    h.supervisor.suspend()
    h.supervisor.recheck()
    advanceTimeBy(RouteSupervisor.TICK.inWholeMilliseconds * 2)
    assertTrue(h.preflights.isEmpty())
  }

  @Test fun aDroppedConnectionReracesEveryAddressOnTheTimer() = runTest {
    val h = Harness(backgroundScope, this, identity, reachable = setOf(tunnel.url))
    h.supervisor.connected(lan)
    h.supervisor.connectionChanged(up = false)
    // The policy's recheck interval gates the timer; ticks before it do nothing.
    advanceTimeBy(150_000)
    assertEquals(listOf(lan.url, tunnel.url), h.preflights.first())
    assertEquals(tunnel.url to false, h.adopted.first())
  }

  @Test fun stoppingStopsWatching() = runTest {
    val h = Harness(backgroundScope, this, identity, reachable = emptySet())
    h.supervisor.stop()
    assertTrue(h.paths.stopped)
  }
}
