package dev.houwert.argus.core.support

import dev.houwert.argus.core.backend.HostBackend
import dev.houwert.argus.core.backend.HostBackendKind
import dev.houwert.argus.core.backend.HostEvent
import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.EventEnvelope
import dev.houwert.argus.kit.protocol.ProtocolJson
import dev.houwert.argus.kit.protocol.RemoteCommand
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * A scripted [HostBackend]: canned JSON replies by method name, events pushed in
 * by the test, and every call recorded with its encoded params. Single-threaded,
 * like the store under test.
 */
class FakeBackend(override val kind: HostBackendKind = HostBackendKind.Local) : HostBackend {
  class Failure : Exception("scripted failure")

  data class Call(val name: String, val params: JsonElement)

  /** Collected by the store once attached; emit only after the collector has started. */
  val eventFlow = MutableSharedFlow<HostEvent>(extraBufferCapacity = 1024)

  private val replies = mutableMapOf<String, String>()
  private val errors = mutableMapOf<String, Throwable>()
  private val gates = mutableMapOf<String, CompletableDeferred<Unit>>()
  private val sent = mutableMapOf<String, JsonElement>()
  private var eventSeq = 0

  /** Answered requests, in order; a held one counts once released. */
  val calls = mutableListOf<Call>()
  val subscriptions = mutableListOf<Pair<String, Boolean>>()

  /** Where a sequenced response falls among this backend's events; MIN_VALUE counts every event as after it. */
  var responseSeq = Int.MIN_VALUE

  fun reply(command: RemoteCommand<*, *>, json: String) = reply(command.name, json)

  fun reply(name: String, json: String) { replies[name] = json }

  fun fail(command: RemoteCommand<*, *>, error: Throwable = Failure()) = fail(command.name, error)

  fun fail(name: String, error: Throwable = Failure()) { errors[name] = error }

  /** Park every call to [command] until [release]. */
  fun hold(command: RemoteCommand<*, *>) { gates[command.name] = CompletableDeferred() }

  fun release(command: RemoteCommand<*, *>) { gates.remove(command.name)?.complete(Unit) }

  fun count(command: RemoteCommand<*, *>) = count(command.name)

  fun count(name: String) = calls.count { it.name == name }

  fun calls(name: String) = calls.filter { it.name == name }

  /** The params last sent with [command], as JSON. */
  fun params(command: RemoteCommand<*, *>): JsonObject? = sent[command.name] as? JsonObject

  fun emit(event: String, agentId: String? = null, payload: String) {
    eventSeq += 1
    val agent = agentId?.let { ""","agent_id":"$it"""" } ?: ""
    val json = """{"seq":$eventSeq,"event":"$event"$agent,"payload":$payload}"""
    val envelope = ProtocolJson.json.decodeFromString(EventEnvelope.serializer(), json)
    check(eventFlow.tryEmit(HostEvent.Event(envelope)))
  }

  fun emitState(state: Transport.State) {
    check(eventFlow.tryEmit(HostEvent.State(state)))
  }

  override fun events(): Flow<HostEvent> = eventFlow

  override suspend fun <P, R> request(command: RemoteCommand<P, R>, params: P): R {
    val encoded = ProtocolJson.encode(command.params, params)
    sent[command.name] = encoded
    gates[command.name]?.await()
    calls += Call(command.name, encoded)
    errors[command.name]?.let { throw it }
    return ProtocolJson.decode(command.result, ProtocolJson.json.parseToJsonElement(replies[command.name] ?: "{}"))
  }

  override suspend fun <P, R> sequencedRequest(command: RemoteCommand<P, R>, params: P): Pair<R, Int> =
    request(command, params) to responseSeq

  override suspend fun subscribe(agentId: String, on: Boolean) { subscriptions += agentId to on }

  override suspend fun disconnect() {}
}
