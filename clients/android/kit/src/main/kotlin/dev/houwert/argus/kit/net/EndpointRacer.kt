package dev.houwert.argus.kit.net

import dev.houwert.argus.kit.storage.DeviceIdentity
import dev.houwert.argus.kit.storage.RemoteEndpoint
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Picks which of a computer's addresses to talk over: every candidate is
 * dialled at once and the simplest one that completes the pinned-key Noise
 * handshake wins. The handshake is the test, not a socket open: a stale LAN IP
 * can be answered by a different machine.
 */
object EndpointRacer {
  /** How long to wait for a better-ranked endpoint once a worse one is up. */
  private val GRACE = 1200.milliseconds
  private val PROBE_TIMEOUT = 8.seconds

  class Attempt(val transport: Transport, val endpoint: RemoteEndpoint) {
    val url get() = endpoint.url
  }

  class RaceException(val reason: Reason) : Exception(reason.name) {
    enum class Reason { NoKnownAddress, Unreachable }
  }

  suspend fun connectBest(identity: DeviceIdentity): Attempt {
    val candidates = identity.candidateEndpoints
    if (candidates.isEmpty()) throw RaceException(RaceException.Reason.NoKnownAddress)
    return race(identity, candidates) ?: throw RaceException(RaceException.Reason.Unreachable)
  }

  /** Race only [candidates], leaving the live connection untouched. */
  suspend fun preflight(identity: DeviceIdentity, candidates: List<RemoteEndpoint>): Attempt? =
    if (candidates.isEmpty()) null else race(identity, candidates.sortedBy { it.priority })

  private sealed interface Outcome {
    data class Ready(val index: Int) : Outcome
    data class Failed(val index: Int) : Outcome
    data object GraceExpired : Outcome
  }

  private suspend fun race(identity: DeviceIdentity, candidates: List<RemoteEndpoint>): Attempt? = coroutineScope {
    val transports = candidates.map { Transport(identity, it.url) }
    val outcomes = Channel<Outcome>(Channel.UNLIMITED)
    val probes = transports.mapIndexed { i, t ->
      launch {
        t.start()
        val ready = withTimeoutOrNull(PROBE_TIMEOUT) {
          // A probe that dropped once is not the address to settle on.
          t.state.first { it == Transport.State.Ready || (it == Transport.State.Offline && t.hasStarted) } == Transport.State.Ready
        } ?: false
        outcomes.send(if (ready) Outcome.Ready(i) else Outcome.Failed(i))
      }
    }

    var best: Int? = null
    val finished = mutableSetOf<Int>()
    var graceArmed = false
    fun noBetterPossible(): Boolean {
      val b = best ?: return false
      return candidates.indices.none { candidates[it].priority < candidates[b].priority && it !in finished }
    }

    loop@ while (true) {
      when (val outcome = outcomes.receive()) {
        is Outcome.Ready -> {
          finished += outcome.index
          val current = best
          if (current == null || candidates[outcome.index].priority < candidates[current].priority) {
            current?.let { transports[it].disconnect() }
            best = outcome.index
          } else {
            transports[outcome.index].disconnect()
          }
          if (candidates[best!!].priority == 0 || noBetterPossible()) break@loop
          if (!graceArmed) {
            graceArmed = true
            launch {
              delay(GRACE)
              outcomes.send(Outcome.GraceExpired)
            }
          }
        }
        is Outcome.Failed -> {
          finished += outcome.index
          transports[outcome.index].disconnect()
          if (best != null && noBetterPossible()) break@loop
          if (best == null && finished.size == candidates.size) break@loop
        }
        Outcome.GraceExpired -> if (best != null) break@loop
      }
    }
    probes.forEach { it.cancel() }
    coroutineContext[kotlinx.coroutines.Job]?.children?.forEach { it.cancel() }
    val winner = best
    transports.forEachIndexed { i, t ->
      if (i != winner) {
        t.disconnect()
        t.close()
      }
    }
    winner?.let { Attempt(transports[it], candidates[it]) }
  }
}
