package dev.houwert.argus.ui.composer

import dev.houwert.argus.kit.protocol.generated.RemoteImageAttachment
import java.util.UUID

/**
 * A UI element picked in the browser or the device inspector, riding the draft as a chip: the
 * agent gets `context` and the `crop` as an image. Built by the inspector's port.
 */
data class PickedElement(
  val source: Source,
  /** The chip's label, e.g. `button.primary`. */
  val title: String,
  /** What the agent reads to find the element in code. */
  val context: String,
  val crop: RemoteImageAttachment?,
  val id: String = UUID.randomUUID().toString(),
) {
  enum class Source { Browser, Device }

  companion object {
    /** The message an agent gets: what was typed, then each element's context. */
    fun body(typed: String, elements: List<PickedElement>): String =
      (listOf(typed.ifEmpty { "(see the picked element)" }) + elements.map { it.context }).joinToString("\n\n")

    /** What the transcript shows instead of the context blocks. */
    fun display(typed: String, elements: List<PickedElement>): String {
      val chips = elements.joinToString(" ") { "[Element: ${it.title}]" }
      return if (typed.isEmpty()) chips else "$typed\n\n$chips"
    }
  }
}
