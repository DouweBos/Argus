package dev.houwert.argus.ui.gallery

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import dev.houwert.argus.core.backend.HostBackend
import dev.houwert.argus.core.backend.HostBackendKind
import dev.houwert.argus.core.backend.HostEvent
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.kit.protocol.ProtocolJson
import dev.houwert.argus.kit.protocol.RemoteCommand
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.serialization.json.JsonElement

/** Answers a gallery story's models from fixtures, by method name; anything else fails as a missing method. */
internal class GalleryBackend(private val replies: Map<String, JsonElement>) : HostBackend {
  override val kind = HostBackendKind.Gateway

  override fun events(): Flow<HostEvent> = emptyFlow()

  override suspend fun <P, R> request(command: RemoteCommand<P, R>, params: P): R {
    val reply = replies[command.name] ?: error("The gallery has no fixture for ${command.name}.")
    return ProtocolJson.decode(command.result, reply)
  }

  override suspend fun subscribe(agentId: String, on: Boolean) {}

  override suspend fun disconnect() {}
}

/** A reply for [GalleryBackend]: the method and its result. */
internal fun <P, R> reply(command: RemoteCommand<P, R>, result: R): Pair<String, JsonElement> =
  command.name to ProtocolJson.encode(command.result, result)

/** A store attached to fixtures, for stories whose views take a real model. */
@Composable
internal fun rememberGalleryHost(vararg replies: Pair<String, JsonElement>): HostStore {
  val scope = rememberCoroutineScope()
  return remember { HostStore(scope).also { it.attach(GalleryBackend(replies.toMap())) } }
}
