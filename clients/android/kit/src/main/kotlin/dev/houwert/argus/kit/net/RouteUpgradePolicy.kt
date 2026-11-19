package dev.houwert.argus.kit.net

import dev.houwert.argus.kit.storage.RemoteEndpoint
import java.time.Instant
import kotlin.math.pow
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import kotlin.time.toJavaDuration

/**
 * When to look for a better route than the one a live connection is on, and
 * how long a failed route is held back so a flaky network doesn't bounce the
 * connection. Pure: the caller supplies the clock and does the dialling.
 */
class RouteUpgradePolicy(
  val recheckInterval: Duration = 120.seconds,
  /** The first back-off after a failed preflight; doubles per failure. */
  val cooldown: Duration = 60.seconds,
  val maxCooldown: Duration = 16.minutes,
  /** A route switched to that drops within this long counts as flaky. */
  val stabilityWindow: Duration = 120.seconds,
) {
  enum class Trigger {
    /** The network path changed, or the app came back to the foreground. */
    PathChanged,
    /** The periodic re-check. */
    Timer,
  }

  sealed interface Plan {
    data object None : Plan
    /** Preflight these, best first, without touching the live connection. */
    data class Upgrade(val candidates: List<RemoteEndpoint>) : Plan
    /** The connection is down: race every candidate, not just the dead address. */
    data class Rerace(val candidates: List<RemoteEndpoint>) : Plan
  }

  /** [sticky] survives a path change: the route worked, then dropped. */
  private data class Strike(val count: Int, val until: Instant, val sticky: Boolean)

  /** The route the live connection is on; null before the first connect. */
  var current: RemoteEndpoint? = null
    private set
  var isUp = false
    private set
  private var upgradedAt: Instant? = null
  private var lastCheck: Instant? = null
  private val strikes = mutableMapOf<String, Strike>()

  /** A connection came up over [endpoint]; [upgraded] when it replaced a live one. */
  fun connected(endpoint: RemoteEndpoint, upgraded: Boolean = false, now: Instant) {
    current = endpoint
    isUp = true
    upgradedAt = if (upgraded) now else null
    lastCheck = now
    if (strikes[endpoint.url]?.sticky != true) strikes.remove(endpoint.url)
  }

  /** The live connection dropped; a route switched to moments ago is held against it. */
  fun connectionLost(now: Instant) {
    if (!isUp) return
    isUp = false
    val current = current
    val upgradedAt = upgradedAt
    if (current != null && upgradedAt != null && now < upgradedAt + stabilityWindow) {
      strike(current.url, sticky = true, now = now)
    }
    this.upgradedAt = null
  }

  /** The owner dropped the connection itself (a fresh connect, another computer). */
  fun disconnected() {
    isUp = false
    upgradedAt = null
  }

  /** The transport reconnected on its own, over the same route. */
  fun connectionRestored() {
    isUp = current != null
  }

  /** A new network gives failed addresses another chance; routes that dropped after a switch stay held. */
  fun pathChanged() {
    strikes.entries.removeAll { !it.value.sticky }
  }

  fun plan(candidates: List<RemoteEndpoint>, trigger: Trigger, now: Instant): Plan {
    val last = lastCheck
    if (trigger == Trigger.Timer && last != null && now < last + recheckInterval) return Plan.None
    val usable = candidates.filter { !coolingDown(it.url, now) }
    if (!isUp) {
      // Down is worse than flaky: with every address held back, try them all.
      if (candidates.isEmpty()) return Plan.None
      return Plan.Rerace(usable.ifEmpty { candidates })
    }
    val current = current ?: return Plan.None
    val better = usable.filter { it.priority < current.priority && it.url != current.url }
    return if (better.isEmpty()) Plan.None else Plan.Upgrade(better)
  }

  /** A check finished: every candidate ranked above the winner (all, without one) backs off. */
  fun checked(candidates: List<RemoteEndpoint>, winner: RemoteEndpoint?, now: Instant) {
    lastCheck = now
    val bar = winner?.priority ?: Int.MAX_VALUE
    for (candidate in candidates) {
      if (candidate.priority < bar) strike(candidate.url, sticky = strikes[candidate.url]?.sticky ?: false, now = now)
    }
  }

  fun coolingDown(url: String, now: Instant): Boolean = strikes[url]?.let { it.until > now } ?: false

  private fun strike(url: String, sticky: Boolean, now: Instant) {
    val count = (strikes[url]?.count ?: 0) + 1
    val wait = minOf(cooldown * 2.0.pow(count - 1), maxCooldown)
    strikes[url] = Strike(count, now + wait, sticky)
  }

  private operator fun Instant.plus(d: Duration): Instant = plus(d.toJavaDuration())
}
