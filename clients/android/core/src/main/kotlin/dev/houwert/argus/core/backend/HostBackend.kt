package dev.houwert.argus.core.backend

import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.EventEnvelope
import dev.houwert.argus.kit.protocol.RemoteCommand
import kotlinx.coroutines.flow.Flow

/**
 * What the shared stores talk to: one host, over whichever channel reaches it.
 * The phone's is [GatewayBackend]; tests and offline reads supply their own.
 */
interface HostBackend {
  val kind: HostBackendKind

  /** The event stream for this backend's lifetime. Collect once. */
  fun events(): Flow<HostEvent>

  /** A generated method (`Methods.X`) or catalog command (`Commands.X`). */
  suspend fun <P, R> request(command: RemoteCommand<P, R>, params: P): R

  /**
   * A request plus where its response falls among this backend's events: an
   * event with a lower `seq` was sent before it. A channel without a shared
   * sequence answers [Int.MIN_VALUE], so every event counts as after it.
   */
  suspend fun <P, R> sequencedRequest(command: RemoteCommand<P, R>, params: P): Pair<R, Int> =
    request(command, params) to Int.MIN_VALUE

  /** Gate `agent.*` / `permission.*` events for one agent. */
  suspend fun subscribe(agentId: String, on: Boolean)

  suspend fun disconnect()
}

enum class HostBackendKind { Gateway, Local }

sealed interface HostEvent {
  data class State(val state: Transport.State) : HostEvent
  /** A typed gateway event (`agent.status`, `sessions.changed`, …). */
  data class Event(val envelope: EventEnvelope) : HostEvent
  /** A binary device-screen frame, after the media tag byte. */
  class Media(val data: ByteArray) : HostEvent
}
