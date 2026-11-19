package dev.houwert.argus.kit.util

import dev.houwert.argus.kit.json.boolValue
import dev.houwert.argus.kit.json.stringValue
import dev.houwert.argus.kit.protocol.generated.RemoteToolCall
import dev.houwert.argus.kit.protocol.generated.RemoteToolCallStatus
import dev.houwert.argus.kit.protocol.generated.RemoteToolResultBlock
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** A claude.ai Artifact an agent published or opened with the Artifact tool: the page to show and its name. */
@Serializable
data class ArtifactLink(val url: String, val title: String, val action: Action) {
  @Serializable
  enum class Action {
    @SerialName("publish") PUBLISH,
    @SerialName("open") OPEN,
  }

  companion object {
    const val TOOL_NAME = "Artifact"

    /** The call shows a page: a publish (not an asset upload) or an open. */
    fun action(call: RemoteToolCall): Action? {
      if (call.name != TOOL_NAME) return null
      return when (call.input["action"].stringValue) {
        null, "publish" -> if (call.input["asset"].boolValue == true) null else Action.PUBLISH
        "open" -> Action.OPEN
        else -> null
      }
    }

    /** The page a finished publish or open landed on; null until it has, or when it failed. */
    fun from(call: RemoteToolCall): ArtifactLink? {
      val action = action(call) ?: return null
      if (call.status != RemoteToolCallStatus.done || call.isError == true) return null
      val text = call.resultBlocks.mapNotNull { (it as? RemoteToolResultBlock.Text)?.value?.text }.joinToString("\n")
      val url = firstArtifactURL(text) ?: call.input["url"].stringValue?.let(::artifactURL) ?: return null
      return ArtifactLink(url, title(call), action)
    }

    /** The CLI names a page after its file when nothing else does; an open has only its link. */
    fun title(call: RemoteToolCall): String {
      val path = call.input["file_path"].stringValue
      if (!path.isNullOrEmpty()) {
        val name = lastPathComponent(path)
        val stem = deletingPathExtension(name)
        return stem.ifEmpty { name }
      }
      return "Artifact"
    }

    /** `…/artifact/{id}` or `…/code/artifact/{uuid}` on claude.ai (or a staging host). */
    internal fun artifactURL(raw: String): String? {
      val uri = parseUri(raw) ?: return null
      if (uri.scheme != "https" || uri.host == null) return null
      val parts = (uri.path ?: "").split('/').filter { it.isNotEmpty() }
      val at = parts.lastIndexOf("artifact")
      if (at < 0 || at + 1 >= parts.size) return null
      return raw
    }

    // Stands in for NSDataDetector: web links, minus the sentence punctuation after them.
    private val linkRegex = Regex("""https?://[^\s<>"'()\[\]{}]+""", RegexOption.IGNORE_CASE)

    internal fun firstArtifactURL(text: String): String? =
      linkRegex.findAll(text).firstNotNullOfOrNull { artifactURL(it.value.trimEnd('.', ',', ';', ':', '!', '?')) }
  }
}
