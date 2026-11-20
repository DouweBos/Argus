package dev.houwert.argus.core.sessions

import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.core.stores.observeIpc
import dev.houwert.argus.kit.protocol.ProtocolJson
import kotlinx.serialization.Serializable

/** One `session:setup_progress` broadcast: which setup step is running and on what. */
@Serializable
data class SetupStep(
  val current: Double,
  val total: Double,
  val item: String,
  val phase: String? = null,
  val detail: String? = null,
)

/** Follow a session's setup broadcasts, which carry more than the listed progress. Returns the stopper. */
fun HostStore.observeSetupProgress(sessionId: String, handler: (SetupStep) -> Unit): () -> Unit {
  val channel = "session:setup_progress:$sessionId"
  return observeIpc { name, args, _ ->
    if (name != channel) return@observeIpc
    val arg = args.firstOrNull() ?: return@observeIpc
    runCatching { ProtocolJson.decode(SetupStep.serializer(), arg) }.getOrNull()?.let(handler)
  }
}
