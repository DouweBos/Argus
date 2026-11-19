package dev.houwert.argus.kit.net

import dev.houwert.argus.kit.crypto.NoiseHandshake
import dev.houwert.argus.kit.crypto.NoiseHandshakeConfig
import dev.houwert.argus.kit.crypto.NoiseRole
import dev.houwert.argus.kit.crypto.NoiseSession
import dev.houwert.argus.kit.json.stringValue
import dev.houwert.argus.kit.protocol.EmptyParams
import dev.houwert.argus.kit.protocol.EventEnvelope
import dev.houwert.argus.kit.protocol.GatewayErrorPayload
import dev.houwert.argus.kit.protocol.ProtocolJson
import dev.houwert.argus.kit.protocol.RemoteCommand
import dev.houwert.argus.kit.protocol.RequestEnvelope
import dev.houwert.argus.kit.protocol.ResponseEnvelope
import dev.houwert.argus.kit.protocol.ServerFrame
import dev.houwert.argus.kit.protocol.SubscribeEnvelope
import dev.houwert.argus.kit.storage.DeviceIdentity
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

/** Why a request failed. [isTransient] ones succeed on a retry once reconnected. */
sealed class TransportException(message: String) : Exception(message) {
  class NotReady : TransportException("Not connected to a computer.")
  class TimedOut : TransportException("The computer didn't answer in time.")
  class BadIdentity : TransportException("This pairing's keys are unreadable.")
  class Gateway(val payload: GatewayErrorPayload) : TransportException(payload.message)
  /** The host has no such method: it runs an older Argus than this client. */
  class Unsupported(val method: String, val hostVersion: String?) : TransportException(unsupportedMessage(hostVersion))

  val isTransient get() = this is NotReady || this is TimedOut

  companion object {
    fun unsupportedMessage(hostVersion: String?) =
      if (hostVersion.isNullOrEmpty()) "This needs a newer version of Argus than the host you're connected to is running."
      else "This needs a newer version of Argus. The host you're connected to is running $hostVersion."
  }
}

/**
 * Steady-state client transport: connects to the gateway's `/device` endpoint,
 * runs the Noise IK initiator handshake against the pinned desktop key, then
 * offers request/response and events over the encrypted channel.
 *
 * All state lives on one serial dispatcher, the way the Swift version is an actor.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class Transport(private val identity: DeviceIdentity, val url: String = identity.url) {
  enum class State { Connecting, Handshaking, Offline, Ready }

  sealed interface Event {
    data class StateChanged(val state: State) : Event
    data class Message(val envelope: EventEnvelope) : Event
    /** A binary device-screen frame, after the media tag byte. */
    class Media(val data: ByteArray) : Event
  }

  private val serial = Dispatchers.IO.limitedParallelism(1)
  private val scope = CoroutineScope(SupervisorJob() + serial)
  private val socket = GatewaySocket("$url/device", scope)

  private val _state = MutableStateFlow(State.Offline)
  val state: StateFlow<State> = _state
  private val _events = MutableSharedFlow<Event>(extraBufferCapacity = 1024)
  val events: SharedFlow<Event> = _events

  private var handshake: NoiseHandshake? = null
  private var session: NoiseSession? = null
  private var hostVersion: String? = null
  private var hostVersionAsked = false
  private var sendSeq = 0
  private var recvSeq = -1
  private val pending = HashMap<String, CompletableDeferred<ResponseEnvelope>>()
  private var pump: Job? = null
  /** Set once the first connect began, so an initial `Offline` reads as not-yet rather than dropped. */
  @Volatile var hasStarted = false
    private set

  fun start() {
    scope.launch {
      setState(State.Connecting)
      hasStarted = true
      pump?.cancel()
      pump = launch { socket.events.collect { handle(it) } }
      socket.connect()
    }
  }

  fun checkAlive() = socket.checkAlive()

  suspend fun disconnect() {
    withContext(serial) {
      pump?.cancel()
      pump = null
      socket.close()
      reset()
      setState(State.Offline)
    }
  }

  fun close() {
    socket.close()
    scope.cancel()
  }

  private fun setState(s: State) {
    _state.value = s
    _events.tryEmit(Event.StateChanged(s))
  }

  private fun reset() {
    hostVersion = null
    hostVersionAsked = false
    handshake = null
    session = null
    sendSeq = 0
    recvSeq = -1
    pending.values.forEach { it.completeExceptionally(TransportException.NotReady()) }
    pending.clear()
  }

  private fun handle(event: GatewaySocket.Event) {
    when (event) {
      GatewaySocket.Event.Open -> startHandshake()
      is GatewaySocket.Event.Frame -> onData(event.data)
      GatewaySocket.Event.Closed -> {
        reset()
        setState(State.Offline)
      }
    }
  }

  private fun startHandshake() {
    setState(State.Handshaking)
    val keypair = identity.keypair
    val remote = identity.desktopStaticKey
    if (keypair == null || remote == null) {
      setState(State.Offline)
      return
    }
    try {
      val hs = NoiseHandshake(NoiseHandshakeConfig(NoiseRole.Initiator, keypair, remote))
      handshake = hs
      socket.send(hs.writeMessage(ByteArray(0)))
    } catch (e: Exception) {
      reset()
      setState(State.Offline)
    }
  }

  private fun onData(bytes: ByteArray) {
    val current = session
    if (current == null) {
      val hs = handshake ?: return
      try {
        hs.readMessage(bytes)
        session = hs.session()
        setState(State.Ready)
      } catch (e: Exception) {
        // Only the real desktop holds the pinned key: this is not it.
        reset()
        setState(State.Offline)
      }
      return
    }
    val plain = runCatching { current.decrypt(bytes) }.getOrNull()?.takeIf { it.isNotEmpty() } ?: return
    val body = plain.copyOfRange(1, plain.size)
    when (plain[0]) {
      TAG_MEDIA -> _events.tryEmit(Event.Media(body))
      TAG_JSON -> {
        val frame = runCatching { ProtocolJson.decodeFrame(body.decodeToString()) }.getOrNull() ?: return
        when (frame) {
          is ServerFrame.Response -> {
            if (frame.envelope.seq <= recvSeq) return
            recvSeq = frame.envelope.seq
            pending.remove(frame.envelope.id)?.complete(frame.envelope)
          }
          is ServerFrame.Event -> {
            if (frame.envelope.seq <= recvSeq) return
            recvSeq = frame.envelope.seq
            _events.tryEmit(Event.Message(frame.envelope))
          }
          ServerFrame.Unknown -> Unit
        }
      }
    }
  }

  /** Seals in numbering order: the gateway drops a frame whose `seq` is behind, and Noise needs nonce order. */
  private fun emit(json: String) {
    val s = session ?: return
    val sealed = runCatching { s.encrypt(byteArrayOf(TAG_JSON) + json.encodeToByteArray()) }.getOrNull() ?: return
    socket.send(sealed)
  }

  suspend fun <P, R> request(command: RemoteCommand<P, R>, params: P, timeout: Duration = REQUEST_TIMEOUT): R {
    val response = exchange(command.name, ProtocolJson.encode(command.params, params), timeout)
    return ProtocolJson.decode(command.result, response.ok ?: JsonNull)
  }

  /** By wire name, for callers holding the name rather than the command. */
  suspend fun <R> request(name: String, params: JsonElement, result: KSerializer<R>, timeout: Duration = REQUEST_TIMEOUT): R {
    val response = exchange(name, params, timeout)
    return ProtocolJson.decode(result, response.ok ?: JsonNull)
  }

  /** A request plus the response's `seq`, so a snapshot can be stitched onto later events. */
  suspend fun <P, R> sequencedRequest(command: RemoteCommand<P, R>, params: P): Pair<R, Int> {
    val response = exchange(command.name, ProtocolJson.encode(command.params, params), REQUEST_TIMEOUT)
    return ProtocolJson.decode(command.result, response.ok ?: JsonNull) to response.seq
  }

  private suspend fun exchange(method: String, params: JsonElement, timeout: Duration): ResponseEnvelope {
    val deferred = CompletableDeferred<ResponseEnvelope>()
    val id = withContext(serial) {
      if (session == null) throw TransportException.NotReady()
      val id = "r$sendSeq"
      val envelope = RequestEnvelope(seq = sendSeq, id = id, method = method, params = params)
      sendSeq++
      pending[id] = deferred
      emit(ProtocolJson.json.encodeToString(RequestEnvelope.serializer(), envelope))
      id
    }
    val response = try {
      withTimeout(timeoutFor(method, timeout)) { deferred.await() }
    } catch (e: TimeoutCancellationException) {
      throw TransportException.TimedOut()
    } finally {
      withContext(serial) { pending.remove(id) }
    }
    val error = response.error ?: return response
    val unsupported = error.unsupportedMethod ?: throw TransportException.Gateway(error)
    throw TransportException.Unsupported(unsupported, knownHostVersion())
  }

  /** Asked once per connection, the first time the host turns out too old. */
  private suspend fun knownHostVersion(): String? {
    if (hostVersionAsked) return hostVersion
    hostVersionAsked = true
    hostVersion = runCatching {
      exchange(VERSION_COMMAND, ProtocolJson.encode(EmptyParams.serializer(), EmptyParams()), REQUEST_TIMEOUT).ok.stringValue
    }.getOrNull()
    return hostVersion
  }

  /**
   * Subscriptions gate which `agent.*` / `permission.*` events reach this
   * connection; the gateway replays pending permission requests on subscribe.
   */
  suspend fun subscribe(agentId: String, on: Boolean) = withContext(serial) {
    if (session == null) return@withContext
    val envelope = SubscribeEnvelope(seq = sendSeq, action = if (on) "subscribe" else "unsubscribe", agentId = agentId)
    sendSeq++
    emit(ProtocolJson.json.encodeToString(SubscribeEnvelope.serializer(), envelope))
  }

  companion object {
    private const val TAG_JSON: Byte = 0x00
    private const val TAG_MEDIA: Byte = 0x01
    /** Admin-tier, so a phone without admin simply doesn't learn it. */
    const val VERSION_COMMAND = "get_app_version"

    val REQUEST_TIMEOUT = 15.seconds
    private val longRequests = mapOf(
      // Plan limits spawn the Claude CLI per account, each probe allowed 20 s on the host.
      "usage.limits" to 30.seconds,
      "get_claude_usage_limits" to 30.seconds,
      // Claude reads the code before it answers a guide question.
      "review_guides.ask" to 4.minutes,
      // The host gives Claude 10 minutes to draft or revise a blueprint.
      "blueprints.draft" to 11.minutes,
      "blueprints.revise" to 11.minutes,
    )
    val LONGEST_REQUEST_TIMEOUT: Duration = longRequests.values.max()

    fun timeoutFor(method: String, requested: Duration = REQUEST_TIMEOUT): Duration =
      maxOf(requested, longRequests[method] ?: requested)
  }
}

