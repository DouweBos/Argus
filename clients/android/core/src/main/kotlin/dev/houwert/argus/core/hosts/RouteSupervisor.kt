package dev.houwert.argus.core.hosts

import dev.houwert.argus.kit.net.EndpointRacer
import dev.houwert.argus.kit.net.NetworkPathWatcher
import dev.houwert.argus.kit.net.RouteUpgradePolicy
import dev.houwert.argus.kit.storage.DeviceIdentity
import dev.houwert.argus.kit.storage.RemoteEndpoint
import java.time.Instant
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Keeps one computer's connection on the best route that works: on a network
 * change or a slow timer it preflights better addresses and hands a winner to
 * its owner, never touching the live connection until the new one is up.
 *
 * [scope] must be single-threaded (the main dispatcher): all state lives there,
 * the way the Swift version is `@MainActor`.
 */
class RouteSupervisor(
  private val hooks: Hooks,
  private val paths: NetworkPathWatcher,
  private val scope: CoroutineScope,
  private val clock: () -> Instant = Instant::now,
  private val preflight: suspend (DeviceIdentity, List<RemoteEndpoint>) -> EndpointRacer.Attempt? =
    { identity, candidates -> EndpointRacer.preflight(identity, candidates) },
) {
  class Hooks(
    /** The computer as currently known; null while there's nothing to supervise. */
    val identity: () -> DeviceIdentity?,
    /** Something bound to this connection would break on a switch. */
    val busy: () -> Boolean = { false },
    /** Adopt a preflight winner (`upgrade` when replacing a live one); false closes it. */
    val adopt: suspend (attempt: EndpointRacer.Attempt, upgrade: Boolean) -> Boolean,
    /** The network moved; for owners with their own retry loop to cut short. */
    val networkChanged: () -> Unit = {},
  )

  private val policy = RouteUpgradePolicy()
  private var ticker: Job? = null
  private var pendingPath: Job? = null
  private var checking = false
  /** The owner is connecting from scratch (its own race decides) or has let go. */
  private var connecting = false
  /** Bumped on every connect, so a check that outlives its connection is dropped. */
  private var epoch = 0

  init {
    paths.start { scope.launch { pathChanged() } }
    ticker = scope.launch {
      while (isActive) {
        delay(TICK)
        evaluate(RouteUpgradePolicy.Trigger.Timer)
      }
    }
  }

  /** The route the connection is on, as of the last connect or switch. */
  val route: RemoteEndpoint? get() = policy.current

  /** Stop watching; the owner is done with this computer. */
  fun stop() {
    paths.stop()
    ticker?.cancel()
    pendingPath?.cancel()
    epoch += 1
  }

  /** The owner is connecting from scratch or let the connection go: checks wait for [connected]. */
  fun suspend() {
    epoch += 1
    connecting = true
    policy.disconnected()
  }

  /** A connect finished: over [endpoint], or nowhere. */
  fun connected(endpoint: RemoteEndpoint?) {
    connecting = false
    if (endpoint != null) policy.connected(endpoint, now = clock())
  }

  /** The connection went up or down on its own. */
  fun connectionChanged(up: Boolean) {
    if (up) policy.connectionRestored() else policy.connectionLost(clock())
  }

  /** The app came back to the foreground: as good as a new network. */
  fun recheck() = pathChanged()

  private fun pathChanged() {
    policy.pathChanged()
    hooks.networkChanged()
    pendingPath?.cancel()
    pendingPath = scope.launch {
      delay(SETTLE)
      evaluate(RouteUpgradePolicy.Trigger.PathChanged)
    }
  }

  private suspend fun evaluate(trigger: RouteUpgradePolicy.Trigger) {
    if (checking || connecting) return
    val identity = hooks.identity() ?: return
    val (upgrade, candidates) = when (val plan = policy.plan(identity.candidateEndpoints, trigger, clock())) {
      RouteUpgradePolicy.Plan.None -> return
      is RouteUpgradePolicy.Plan.Upgrade -> {
        // Retried on the next tick rather than cutting a stream off.
        if (hooks.busy()) return
        true to plan.candidates
      }
      is RouteUpgradePolicy.Plan.Rerace -> false to plan.candidates
    }

    checking = true
    try {
      val started = epoch
      val attempt = preflight(identity, candidates)
      if (started != epoch) {
        attempt?.release()
        return
      }
      policy.checked(candidates, attempt?.endpoint, clock())
      if (attempt == null) return
      val adopted = worthAdopting(attempt.endpoint, upgrade) && hooks.adopt(attempt, upgrade)
      if (!adopted) {
        attempt.release()
        return
      }
      policy.connected(attempt.endpoint, upgraded = upgrade, now = clock())
    } finally {
      checking = false
    }
  }

  /** A stream may have started during the race, or the old connection come back over as good a route. */
  private fun worthAdopting(winner: RemoteEndpoint, upgrade: Boolean): Boolean {
    if (upgrade) return !hooks.busy()
    val current = policy.current
    if (!policy.isUp || current == null) return true
    return winner.priority < current.priority
  }

  private suspend fun EndpointRacer.Attempt.release() {
    transport.disconnect()
    transport.close()
  }

  companion object {
    val TICK = 30.seconds
    /** Joining Wi-Fi reports several paths in a row; dial once it settles. */
    val SETTLE = 2.seconds
  }
}
