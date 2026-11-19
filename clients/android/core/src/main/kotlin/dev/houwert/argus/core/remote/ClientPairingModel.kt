package dev.houwert.argus.core.remote

import dev.houwert.argus.kit.net.PairingClient
import dev.houwert.argus.kit.net.PairingClientInfo
import dev.houwert.argus.kit.net.PairingError
import dev.houwert.argus.kit.net.PairingException
import dev.houwert.argus.kit.net.PairingPayload
import dev.houwert.argus.kit.storage.DeviceIdentity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.job
import kotlinx.coroutines.launch

/**
 * The pair screen's state: scan the computer's QR (or paste its code), show the
 * six digits to compare, then hand the grant to [onPaired]. The iPhone keeps
 * this in `PairView`; ArgusCore's `PairingModel` is the host side and not ported.
 */
class ClientPairingModel(
  private val scope: CoroutineScope,
  private val client: PairingClientInfo,
  /** Store the pairing and connect; the screen leaves once [Phase.Paired] shows. */
  private val onPaired: suspend (DeviceIdentity) -> Unit,
  /** For telemetry: why a pairing failed, never what it paired. */
  private val onFailed: (PairingError) -> Unit = {},
  private val connect: (PairingPayload, PairingClientInfo) -> Flow<PairingClient.Event> =
    { payload, info -> PairingClient(payload, client = info).start() },
) {
  sealed interface Phase {
    data object Scan : Phase
    data class AwaitingConfirmation(val sas: String) : Phase
    data object Paired : Phase
  }

  data class State(val phase: Phase = Phase.Scan, val error: String? = null)

  private val _state = MutableStateFlow(State())
  val state: StateFlow<State> = _state

  private var pump: Job? = null

  /** A scanned or pasted code; ignored while a pairing is already under way. */
  fun begin(raw: String) {
    if (pump != null) return
    _state.update { it.copy(error = null) }
    val payload = try {
      PairingClient.parse(raw)
    } catch (e: PairingException) {
      onFailed(PairingError.InvalidCode)
      _state.update { it.copy(error = message(PairingError.InvalidCode)) }
      return
    }
    // Lazy so [pump] is set before the first event can clear it.
    val job = scope.launch(start = CoroutineStart.LAZY) {
      try {
        connect(payload, client).collect { event ->
          when (event) {
            is PairingClient.Event.Sas -> _state.value = State(Phase.AwaitingConfirmation(event.code))
            is PairingClient.Event.Paired -> {
              onPaired(event.identity)
              _state.value = State(Phase.Paired)
            }
            is PairingClient.Event.Failed -> {
              onFailed(event.error)
              _state.value = State(Phase.Scan, message(event.error))
            }
          }
        }
      } finally {
        if (pump === coroutineContext.job) pump = null
      }
    }
    pump = job
    job.start()
  }

  /** Abandon the pairing and go back to scanning; closing the flow closes the socket. */
  fun cancel() {
    pump?.cancel()
    pump = null
    if (_state.value.phase is Phase.AwaitingConfirmation) _state.value = State()
  }

  companion object {
    fun canSubmit(code: String) = code.isNotBlank()

    fun message(error: PairingError): String = when (error) {
      PairingError.InvalidCode -> "That doesn't look like a valid pairing code."
      PairingError.HandshakeFailed -> "Pairing failed — wrong code, or a machine in the middle."
      PairingError.UnreadableGrant -> "Couldn't read the pairing grant."
      PairingError.Cancelled -> "Pairing cancelled."
    }
  }
}

/** The case name alone, as the iPhone reports it; the message says more than a funnel needs. */
val PairingError.telemetryReason: String get() = name.replaceFirstChar { it.lowercase() }
