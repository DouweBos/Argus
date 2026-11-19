package dev.houwert.argus.core.offline

import dev.houwert.argus.core.stores.FailedSend
import dev.houwert.argus.kit.storage.SealedFiles
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * Replies written while the computer was out of reach, sealed on disk until the
 * next connection sends them. Bounded: a day-old reply is more likely to
 * confuse an agent that moved on than to help it.
 */
class Outbox(private val files: SealedFiles) {
  @Serializable
  data class Entry(val agentId: String, val message: FailedSend, /** Epoch ms. */ val at: Long)

  fun load(now: Long = System.currentTimeMillis()): List<Entry> {
    val data = files.read(FILE_NAME) ?: return emptyList()
    val entries = runCatching { json.decodeFromString(serializer, data.decodeToString()) }.getOrNull() ?: return emptyList()
    return entries.filter { now - it.at <= MAX_AGE_MS }
  }

  fun save(entries: List<Entry>) {
    if (entries.isEmpty()) return files.remove(FILE_NAME)
    files.write(json.encodeToString(serializer, entries.takeLast(MAX_QUEUED)).encodeToByteArray(), FILE_NAME)
  }

  companion object {
    const val MAX_AGE_MS = 24L * 60 * 60 * 1000
    const val MAX_QUEUED = 20
    private const val FILE_NAME = "replies"
    private val json = Json { ignoreUnknownKeys = true }
    private val serializer = ListSerializer(Entry.serializer())

    /** One computer's outbox inside the app's `Outbox` folder. */
    fun forHost(root: SealedFiles, hostId: String) = Outbox(root.folder("Outbox").folder(hostId))

    fun remove(root: SealedFiles, hostId: String) = root.folder("Outbox").folder(hostId).removeAll()
  }
}
