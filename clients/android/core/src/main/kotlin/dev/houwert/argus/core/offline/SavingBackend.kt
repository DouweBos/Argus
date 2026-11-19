package dev.houwert.argus.core.offline

import dev.houwert.argus.core.backend.HostBackend
import dev.houwert.argus.core.backend.HostBackendKind
import dev.houwert.argus.core.backend.HostEvent
import dev.houwert.argus.core.stores.HostStore
import dev.houwert.argus.kit.net.TransportException
import dev.houwert.argus.kit.protocol.ProtocolJson
import dev.houwert.argus.kit.protocol.RemoteCommand
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow

/**
 * The phone's backend with its saved answers behind it: reads that succeed are
 * kept, and reads the connection can't carry are answered from what was kept.
 * Everything that acts goes to the live connection only.
 */
class SavingBackend(
  val live: HostBackend?,
  val saved: SavedAnswers,
  /** An answer came from disk rather than the computer; when it was saved (epoch ms). */
  private val servedSaved: (Long) -> Unit = {},
) : HostBackend {
  override val kind get() = live?.kind ?: HostBackendKind.Gateway

  override fun events(): Flow<HostEvent> = live?.events() ?: emptyFlow()

  override suspend fun <P, R> request(command: RemoteCommand<P, R>, params: P): R {
    if (command.name !in SavedAnswers.methods) return (live ?: throw TransportException.NotReady()).request(command, params)
    val key = SavedAnswers.key(command.name, ProtocolJson.encode(command.params, params))
    return try {
      val result = (live ?: throw TransportException.NotReady()).request(command, params)
      runCatching { ProtocolJson.encode(command.result, result) }.getOrNull()?.let { saved.save(it, key) }
      result
    } catch (e: Exception) {
      ProtocolJson.decode(command.result, fallback(key, e))
    }
  }

  override suspend fun <P, R> sequencedRequest(command: RemoteCommand<P, R>, params: P): Pair<R, Int> {
    if (command.name !in SavedAnswers.methods) return (live ?: throw TransportException.NotReady()).sequencedRequest(command, params)
    val key = SavedAnswers.key(command.name, ProtocolJson.encode(command.params, params))
    return try {
      val (result, seq) = (live ?: throw TransportException.NotReady()).sequencedRequest(command, params)
      runCatching { ProtocolJson.encode(command.result, result) }.getOrNull()?.let { saved.save(it, key) }
      result to seq
    } catch (e: Exception) {
      ProtocolJson.decode(command.result, fallback(key, e)) to Int.MIN_VALUE
    }
  }

  override suspend fun subscribe(agentId: String, on: Boolean) { live?.subscribe(agentId, on) }

  override suspend fun disconnect() { live?.disconnect() }

  /** Only a connection failure falls back: the computer refusing a read is an answer. */
  private fun fallback(key: String, error: Exception): kotlinx.serialization.json.JsonElement {
    if (!HostStore.isTransient(error)) throw error
    val answer = saved.answer(key) ?: throw error
    servedSaved(answer.savedAt)
    return answer.value
  }
}
