package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.EventsTypes
import dev.houwert.argus.kit.protocol.generated.RemoteAgentStatus
import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteTask
import dev.houwert.argus.kit.protocol.generated.RemoteTodo
import kotlinx.coroutines.flow.update

/** Where a held transcript sits among the host's `agent.transcript` deltas. */
internal data class TranscriptSync(val epoch: String, val revision: Long)

/** `agent.transcript`: messages upserted by id, ids removed, and the current meta (null clears). */
internal data class TranscriptDelta(
  val agentId: String,
  val epoch: String,
  val revision: Long,
  val total: Long,
  val messages: List<RemoteMessage>,
  val removedIds: List<String>,
  val title: String? = null,
  val model: String? = null,
  val pendingToolName: String? = null,
  val tasks: List<RemoteTask>? = null,
  val todos: List<RemoteTodo>? = null,
  /** Null from an older host. */
  val followUps: List<String>? = null,
) {
  companion object {
    fun from(p: EventsTypes.AgentTranscriptPayload) = TranscriptDelta(
      p.agentId, p.epoch, p.revision, p.total, p.messages, p.removedIds, p.title, p.model, p.pendingToolName, p.tasks, p.todos, p.followUps,
    )
  }
}

// Following the host's transcript: the tail page says where it stands, each
// delta moves it one revision on. Anything that doesn't line up falls back to
// refetching the tail; a host that sends no deltas keeps the refetch-per-event path.

/** Whether this agent's transcript follows deltas, so polling it is waste. */
fun HostStore.followsTranscriptDeltas(key: String) = transcriptSync[key] != null && key in deltaAgents

/** A refetch of the tail (the poll behind a screen, the check after a send) only a host sending no deltas needs. */
suspend fun HostStore.refreshTranscript(agentId: String) {
  // A saved chat never changes.
  if (followsTranscriptDeltas(agentId) || HostStore.parseStoppedKey(agentId) != null) return
  loadTranscript(agentId)
}

/** Events only say the transcript moved; once deltas carry the change itself they need no refetch. */
internal fun HostStore.refreshUnlessFollowing(agentId: String) {
  if (agentId in deltaAgents) return
  scheduleTranscriptRefresh(agentId)
}

internal fun HostStore.receive(delta: TranscriptDelta) {
  val key = delta.agentId
  deltaAgents += key
  if ((tailFetches[key] ?: 0) > 0) {
    bufferedDeltas.getOrPut(key) { mutableListOf() } += delta
    return
  }
  applyOrRefetch(delta)
}

private fun HostStore.applyOrRefetch(delta: TranscriptDelta) {
  val key = delta.agentId
  val known = transcriptSync[key]
  if (known != null && known.epoch == delta.epoch) {
    if (delta.revision <= known.revision) return
    if (delta.revision == known.revision + 1) return applyDelta(delta)
  }
  // Out of line: the next tail page re-establishes where it stands. An agent no screen shows waits until one opens it.
  transcriptSync.remove(key)
  if (key in watchedAgents) scheduleTranscriptRefresh(key)
}

private fun HostStore.applyDelta(delta: TranscriptDelta) {
  val key = delta.agentId
  transcriptSync[key] = transcriptSync[key]!!.copy(revision = delta.revision)
  // A rewind can cut below the loaded window; its older-page cursor would point past the end.
  val cursor = _prevBeforeByAgent.value[key]
  if (cursor != null && delta.total < cursor) {
    transcriptSync.remove(key)
    _prevBeforeByAgent.update { it - key }
    _messagesByAgent.update { it - key }
    scheduleTranscriptRefresh(key)
    return
  }
  val existing = _messagesByAgent.value[key].orEmpty()
  val next = HostStore.applying(delta, existing, olderUnloaded = _prevBeforeByAgent.value[key] != null)
  if (next != existing) _messagesByAgent.update { it + (key to next) }
  reconcileOptimistic(key, next)

  _tasksByAgent.update { it.with(key, delta.tasks) }
  _todosByAgent.update { it.with(key, delta.todos) }
  setFollowUps(delta.followUps, key)
  _pendingToolByAgent.update { it.with(key, delta.pendingToolName) }
  delta.title?.let { title -> patchStatus(key) { it.copy(title = title) } }
  delta.model?.let { model -> patchStatus(key) { it.copy(model = model) } }
}

/** An empty or missing list clears the agent's suggestions. */
internal fun HostStore.setFollowUps(followUps: List<String>?, key: String) {
  val next = followUps.orEmpty()
  if (_followUpsByAgent.value[key].orEmpty() == next) return
  _followUpsByAgent.update { it.with(key, next.ifEmpty { null }) }
}

/**
 * Upsert by id. An unknown message older than the loaded window belongs to a
 * page not fetched yet, not at the end.
 */
internal fun HostStore.Companion.applying(delta: TranscriptDelta, existing: List<RemoteMessage>, olderUnloaded: Boolean): List<RemoteMessage> {
  val removed = delta.removedIds.toSet()
  val messages = existing.filterNot { it.id in removed }.toMutableList()
  val index = HashMap<String, Int>()
  messages.forEachIndexed { i, m -> index.putIfAbsent(m.id, i) }
  val floor = if (olderUnloaded) messages.firstOrNull()?.timestamp else null
  for (message in delta.messages) {
    val at = index[message.id]
    when {
      at != null -> if (messages[at] != message) messages[at] = message
      floor != null && message.timestamp != null && message.timestamp!! < floor -> Unit
      else -> {
        index[message.id] = messages.size
        messages += message
      }
    }
  }
  return messages
}

internal fun HostStore.patchStatus(agentId: String, body: (RemoteAgentStatus) -> RemoteAgentStatus) {
  _statusByAgent.value[agentId]?.let { status ->
    val next = body(status)
    if (next != status) _statusByAgent.update { it + (agentId to next) }
  }
  _agentsByRepo.update { byRepo -> byRepo.mapValues { (_, agents) -> agents.map { if (it.agentId == agentId) body(it) else it } } }
  _recentAgents.update { agents -> agents.map { if (it.agentId == agentId) body(it) else it } }
}

// Tail fetches

internal fun HostStore.tailFetchStarted(key: String) {
  tailFetches[key] = (tailFetches[key] ?: 0) + 1
}

/** Whether a tail page is older than what the deltas already brought: a slow fetch landing after a newer one. */
internal fun HostStore.isStale(page: RemoteTranscript, key: String): Boolean {
  val epoch = page.epoch ?: return false
  val revision = page.revision ?: return false
  val known = transcriptSync[key] ?: return false
  return known.epoch == epoch && revision < known.revision
}

/** A page from a new epoch is a re-seeded conversation: what was held belongs to the old one. */
internal fun HostStore.replaceIfNewEpoch(page: RemoteTranscript, key: String) {
  val epoch = page.epoch ?: return
  val held = heldEpochs[key]
  if (held != null && held != epoch) {
    _messagesByAgent.update { it - key }
    _prevBeforeByAgent.update { it - key }
  }
  heldEpochs[key] = epoch
}

/** A tail page landed (or was skipped as stale): take its position, then replay what arrived meanwhile. */
internal fun HostStore.tailFetchLanded(key: String, page: RemoteTranscript) {
  val epoch = page.epoch
  val revision = page.revision
  if (epoch != null && revision != null) {
    if (!isStale(page, key)) transcriptSync[key] = TranscriptSync(epoch, revision)
  } else {
    // An older host, or a fetch that failed: nothing to line deltas up against.
    transcriptSync.remove(key)
  }
  val remaining = maxOf(0, (tailFetches[key] ?: 0) - 1)
  if (remaining == 0) tailFetches.remove(key) else tailFetches[key] = remaining
  if (remaining != 0) return
  val buffered = bufferedDeltas.remove(key) ?: return
  buffered.forEach { applyOrRefetch(it) }
}

/** A new connection: every shown transcript is fetched again, and events refetch until the first delta arrives. */
internal fun HostStore.resyncTranscripts() {
  forgetTranscriptSync()
  watchedAgents.forEach { scheduleTranscriptRefresh(it) }
}

internal fun HostStore.forgetTranscriptSync() {
  transcriptSync.clear()
  tailFetches.clear()
  bufferedDeltas.clear()
  deltaAgents.clear()
}
