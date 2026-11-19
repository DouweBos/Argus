package dev.houwert.argus.core.stores

import dev.houwert.argus.kit.protocol.generated.RemoteImageAttachment
import dev.houwert.argus.kit.util.LinkedProjects
import kotlinx.serialization.Serializable

/**
 * A message this client could not hand to the computer, kept with the body it
 * would have sent so retrying is one tap rather than retyping.
 */
@Serializable
data class FailedSend(
  val id: String,
  val body: String,
  val displayText: String? = null,
  val images: List<RemoteImageAttachment> = emptyList(),
) {
  /** What the user actually typed, without the linked-projects preamble. */
  val text: String get() = LinkedProjects.parsePreamble(body)?.rest ?: displayText ?: body
}
