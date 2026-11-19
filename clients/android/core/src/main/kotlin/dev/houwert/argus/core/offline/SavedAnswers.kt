package dev.houwert.argus.core.offline

import dev.houwert.argus.kit.protocol.generated.Commands
import dev.houwert.argus.kit.storage.SealedFiles
import java.security.MessageDigest
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * One computer's last answers to the reads worth having offline, sealed on
 * disk so they are still readable after a restart with no connection. Bounded
 * by size, least recently used out first.
 */
class SavedAnswers(private val files: SealedFiles, private val budget: Int = DEFAULT_BUDGET) {
  @Serializable
  internal data class Entry(val file: String, var savedAt: Long, var usedAt: Long, val size: Int, val digest: String)

  @Serializable
  private data class Index(val entries: MutableMap<String, Entry> = mutableMapOf()) {
    val totalSize get() = entries.values.sumOf { it.size }
  }

  private val lock = Any()
  private val index: Index
  private var lastIndexWrite = 0L

  init {
    val loaded = files.read(INDEX_NAME)?.let { runCatching { json.decodeFromString(Index.serializer(), it.decodeToString()) }.getOrNull() }
    // An index that won't open (a lost key) leaves its answers unreadable too.
    if (loaded == null) files.removeAll()
    index = loaded ?: Index()
  }

  data class Answer(val value: JsonElement, /** Epoch ms. */ val savedAt: Long)

  fun answer(key: String, now: Long = System.currentTimeMillis()): Answer? {
    val entry = synchronized(lock) { index.entries[key]?.also { it.usedAt = now } } ?: return null
    val value = files.read(entry.file)?.let { runCatching { json.parseToJsonElement(it.decodeToString()) }.getOrNull() }
    if (value == null) {
      synchronized(lock) { index.entries.remove(key) }
      return null
    }
    return Answer(value, entry.savedAt)
  }

  fun save(value: JsonElement, key: String, now: Long = System.currentTimeMillis()) {
    val data = canonical(value).encodeToByteArray()
    val digest = sha256Hex(data)
    val file = fileName(key)
    synchronized(lock) {
      val held = index.entries[key]
      // Unchanged content only moves its timestamps, and a poll re-confirms it every few seconds.
      if (held?.digest == digest) {
        held.savedAt = now
        held.usedAt = now
        if (now - lastIndexWrite >= 30_000) writeIndexLocked(now)
        return
      }
    }
    if (!files.write(data, file)) return
    val evicted = mutableListOf<String>()
    synchronized(lock) {
      index.entries[key] = Entry(file, now, now, data.size, digest)
      var total = index.totalSize
      for ((old, entry) in index.entries.filter { it.key != key }.entries.sortedBy { it.value.usedAt }) {
        if (total <= budget && index.entries.size <= MAX_ENTRIES) break
        index.entries.remove(old)
        total -= entry.size
        evicted += entry.file
      }
      writeIndexLocked(now)
    }
    evicted.forEach { files.remove(it) }
  }

  fun clear() {
    synchronized(lock) { index.entries.clear() }
    files.removeAll()
  }

  internal val entryCount get() = synchronized(lock) { index.entries.size }

  private fun writeIndexLocked(now: Long) {
    lastIndexWrite = now
    files.write(json.encodeToString(Index.serializer(), index).encodeToByteArray(), INDEX_NAME)
  }

  companion object {
    /** Reads whose answers are kept. Anything that acts is never replayed. */
    val methods: Set<String> = setOf(
      "projects.list", "sessions.list", "scratch_pads.list", "agents.list", "agents.status",
      "agents.stopped", "agents.transcript", "agents.stopped_transcript", "agents.image",
      "agents.stopped_image", "agents.queue_list", "agents.capabilities", "sessions.git_status",
      "sessions.diff", "github.pull_requests", "github.pull_request",
      Commands.ProposalsList.name, Commands.ProposalGet.name,
      Commands.AutomationRunsList.name, Commands.AutomationRunGet.name, Commands.GetSession.name,
    )

    const val DEFAULT_BUDGET = 32 * 1024 * 1024
    internal const val MAX_ENTRIES = 800
    private const val INDEX_NAME = "index"
    private val json = Json { ignoreUnknownKeys = true }

    fun forHost(root: SealedFiles, hostId: String) = SavedAnswers(root.folder("SavedAnswers").folder(hostId))

    fun remove(root: SealedFiles, hostId: String) = root.folder("SavedAnswers").folder(hostId).removeAll()

    fun key(method: String, params: JsonElement) = "$method ${canonical(params)}"

    /** Sorted keys, so the same params always make the same key. */
    fun canonical(value: JsonElement): String = when (value) {
      is JsonObject -> value.entries.sortedBy { it.key }.joinToString(",", "{", "}") { (k, v) -> "${quoted(k)}:${canonical(v)}" }
      is JsonArray -> value.joinToString(",", "[", "]") { canonical(it) }
      else -> value.toString()
    }

    private fun quoted(s: String) = kotlinx.serialization.json.JsonPrimitive(s).toString()

    private fun sha256Hex(data: ByteArray) = MessageDigest.getInstance("SHA-256").digest(data).joinToString("") { "%02x".format(it) }

    private fun fileName(key: String) = sha256Hex(key.encodeToByteArray()).take(32)
  }
}
