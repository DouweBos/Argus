package dev.houwert.argus.core.stores

import dev.houwert.argus.core.backend.HostBackend
import dev.houwert.argus.core.offline.Outbox
import dev.houwert.argus.core.offline.SavedAnswers
import dev.houwert.argus.core.offline.SavingBackend
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.generated.RemoteImageAttachment
import java.util.UUID
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

// Reading a computer that isn't there: saved answers stand in for the
// connection, and replies wait in an outbox until it comes back.

/** The connection itself, without the saved answers in front of it. */
val HostStore.liveBackend: HostBackend?
  get() = (backend as? SavingBackend)?.live ?: backend.takeIf { it !is SavingBackend }

/** Off the connection with saved answers to read: screens that only poll while connected load once from those. */
val HostStore.readsSaved: Boolean get() = connection.value != Transport.State.Ready && savedAnswers != null

/** Offline, what's held already came from the connection or deltas since; a saved answer would only be older. */
internal fun HostStore.holdsFresher(held: Boolean) = held && connection.value != Transport.State.Ready

/** Read and reply to this computer offline from now on; until a connection attaches, the screen shows what was saved. */
suspend fun HostStore.openOffline(saved: SavedAnswers?, outbox: Outbox?) {
  savedAnswers = saved
  this.outbox = outbox
  _savedAsOf.value = null
  _outboxByAgent.value = (outbox?.load() ?: emptyList()).groupBy({ it.agentId }, { it.message })
  if (saved == null || liveBackend != null) return
  backend = offlineBackend(saved)
  // Home polls its lists only while connected.
  BackgroundRefresh.run {
    refreshProjects()
    loadRecentAgents()
    loadScratchPads()
  }
}

internal fun HostStore.wrapForOffline(live: HostBackend): HostBackend {
  val saved = savedAnswers ?: return live
  return SavingBackend(live, saved) { servedSaved(it) }
}

internal fun HostStore.offlineBackend(saved: SavedAnswers) = SavingBackend(null, saved) { servedSaved(it) }

/** The oldest answer on screen sets the age shown, so it never reads fresher than it is. */
private fun HostStore.servedSaved(at: Long) {
  scope.launch {
    if (connection.value == Transport.State.Ready) return@launch
    _savedAsOf.update { held -> if (held == null || at < held) at else held }
  }
}

/** Whether a reply should wait for the connection rather than be tried now. */
internal val HostStore.shouldHoldReply: Boolean
  get() = outbox != null && (liveBackend == null || connection.value != Transport.State.Ready)

internal fun HostStore.holdReply(agentId: String, message: String, displayText: String?, images: List<RemoteImageAttachment>) {
  val held = FailedSend("outbox-${UUID.randomUUID()}", message, displayText, images)
  _outboxByAgent.update { it + (agentId to (it[agentId].orEmpty() + held)) }
  persistOutbox(mapOf(held.id to System.currentTimeMillis()))
  hooks.track(StoreEvent.OfflineReply(StoreEvent.OfflineReplyAction.Queued))
}

fun HostStore.discardHeld(agentId: String, id: String) {
  _outboxByAgent.update { it.removingItem(agentId) { m -> m.id == id } }
  persistOutbox()
  hooks.track(StoreEvent.OfflineReply(StoreEvent.OfflineReplyAction.Discarded))
}

/** Send what waited, oldest first, once: a second connection arriving mid-flush must not send anything twice. */
internal fun HostStore.flushOutbox() {
  val box = outbox ?: return
  if (outboxFlushing || connection.value != Transport.State.Ready || liveBackend == null) return
  val entries = box.load()
  if (entries.isEmpty()) return
  outboxFlushing = true
  scope.launch {
    try {
      for (entry in entries.sortedBy { it.at }) {
        if (connection.value != Transport.State.Ready) return@launch
        _outboxByAgent.update { it.removingItem(entry.agentId) { m -> m.id == entry.message.id } }
        persistOutbox()
        hooks.track(StoreEvent.OfflineReply(StoreEvent.OfflineReplyAction.Replayed))
        sendMessage(entry.agentId, entry.message.body, entry.message.images, entry.message.displayText)
      }
    } finally {
      outboxFlushing = false
    }
  }
}

/** Write the outbox as it stands, keeping each entry's original time. */
private fun HostStore.persistOutbox(adding: Map<String, Long> = emptyMap()) {
  val box = outbox ?: return
  val known = box.load().associate { it.message.id to it.at }
  val now = System.currentTimeMillis()
  val entries = _outboxByAgent.value.flatMap { (agentId, messages) ->
    messages.map { Outbox.Entry(agentId, it, known[it.id] ?: adding[it.id] ?: now) }
  }
  box.save(entries.sortedBy { it.at })
}
