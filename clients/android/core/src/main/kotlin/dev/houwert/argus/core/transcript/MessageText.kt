package dev.houwert.argus.core.transcript

import dev.houwert.argus.kit.protocol.generated.RemoteMessage
import dev.houwert.argus.kit.protocol.generated.RemoteMessageRole
import dev.houwert.argus.kit.util.LinkedProjects

private fun RemoteMessage.linkedPreamble(): LinkedProjects.Parsed? =
  if (role == RemoteMessageRole.user) LinkedProjects.parsePreamble(textBlocks.joinToString("\n")) else null

/** What the bubble shows: the user's own words without the linked-projects preamble, and no blank blocks. */
val RemoteMessage.displayBlocks: List<String>
  get() {
    linkedPreamble()?.let { return if (it.rest.isEmpty()) emptyList() else listOf(it.rest) }
    return textBlocks.filter { it.isNotBlank() }
  }

/** What Copy puts on the clipboard: the shown blocks a blank line apart; null when there's no text. */
val RemoteMessage.copyText: String?
  get() = displayBlocks.map { it.trim() }.filter { it.isNotEmpty() }.joinToString("\n\n").ifEmpty { null }

/** What an edit starts from: the shown text, preamble off. */
val RemoteMessage.editableText: String get() = displayBlocks.joinToString("\n\n")

/** An edit as it is sent: the linked-projects preamble goes back on as it came off. */
fun RemoteMessage.resendText(edited: String): String {
  val linked = linkedPreamble() ?: return edited
  return textBlocks.joinToString("\n").dropLast(linked.rest.length) + edited
}
