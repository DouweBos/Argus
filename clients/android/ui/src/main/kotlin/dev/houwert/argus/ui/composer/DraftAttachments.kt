package dev.houwert.argus.ui.composer

import dev.houwert.argus.kit.protocol.generated.RemoteImageAttachment
import dev.houwert.argus.kit.storage.InMemoryKeyValueStore
import dev.houwert.argus.kit.storage.Preferences
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

/**
 * A draft's images per agent, so a switch away or a relaunch keeps them. With a `directory` they
 * live in a file per agent; without one, in memory for the life of the process.
 */
class DraftAttachments(private val directory: File? = null) {
  private val memory = ConcurrentHashMap<String, List<RemoteImageAttachment>>()
  private val serializer = ListSerializer(RemoteImageAttachment.serializer())

  fun load(agentId: String): List<RemoteImageAttachment> {
    val dir = directory ?: return memory[agentId].orEmpty()
    val file = file(dir, agentId)
    if (!file.exists()) return emptyList()
    return runCatching { Json.decodeFromString(serializer, file.readText()) }.getOrDefault(emptyList())
  }

  /** No attachments removes the agent's entry. */
  fun save(attachments: List<RemoteImageAttachment>, agentId: String) {
    if (attachments.isEmpty()) return remove(agentId)
    val dir = directory ?: run { memory[agentId] = attachments; return }
    runCatching {
      dir.mkdirs()
      val target = file(dir, agentId)
      val temp = File(dir, target.name + ".tmp")
      temp.writeText(Json.encodeToString(serializer, attachments))
      temp.renameTo(target)
    }
  }

  fun remove(agentId: String) {
    val dir = directory ?: run { memory.remove(agentId); return }
    file(dir, agentId).delete()
  }

  /** Agent ids can carry slashes; the file name mustn't. */
  private fun file(dir: File, agentId: String) =
    File(dir, agentId.encodeToByteArray().joinToString("") { "%02x".format(it) } + ".json")
}

/** Process-wide draft stores, so a draft outlives the screen it was typed on. Pass the app's own to outlive a relaunch. */
object ComposerDrafts {
  val preferences = Preferences(InMemoryKeyValueStore())
  val images = DraftAttachments()
}
