package dev.houwert.argus.kit.storage

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer

/** A permission answer given from a notification while the app was offline. */
@Serializable
data class PendingDecision(
  val agentId: String,
  /** Which computer owns the agent; an answer for another computer waits for it rather than going to whoever is connected. */
  val hostId: String? = null,
  val toolUseId: String,
  val decision: String,
  val at: Double,
) {
  val key: String get() = "$agentId:$toolUseId"
}

/**
 * Answers queued while offline, replayed once the gateway is back. Bounded on purpose: an answer
 * to a prompt nobody waits on any more is worse than none, so anything past half an hour is dropped.
 */
class PendingDecisionStore(private val preferences: Preferences) {
  private val serializer = ListSerializer(PendingDecision.serializer())

  private fun all(): List<PendingDecision> = preferences.decode(PreferenceKey.PENDING_DECISIONS, serializer) ?: emptyList()

  fun read(now: Double = System.currentTimeMillis().toDouble(), hostId: String? = null): List<PendingDecision> =
    all().filter { entry ->
      if (now - entry.at > MAX_AGE) return@filter false
      // One with no recorded host predates host tracking; let it through rather than strand it.
      hostId == null || entry.hostId == null || entry.hostId == hostId
    }

  fun queue(decision: PendingDecision) {
    val all = all().filter { it.key != decision.key } + decision
    preferences.encode(all.takeLast(MAX_QUEUED), serializer, PreferenceKey.PENDING_DECISIONS)
  }

  fun clear(key: String) {
    preferences.encode(all().filter { it.key != key }, serializer, PreferenceKey.PENDING_DECISIONS)
  }

  companion object {
    const val MAX_AGE: Double = 30 * 60 * 1000.0
    const val MAX_QUEUED = 10
  }
}
