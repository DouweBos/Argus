package dev.houwert.argus.core.backend

import dev.houwert.argus.kit.net.Transport
import dev.houwert.argus.kit.protocol.RemoteCommand
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map

/** The phone's link to a paired computer: a live Noise [Transport] behind [HostBackend]. */
class GatewayBackend(
  /** Already connected: endpoint racing hands over the winner. */
  val transport: Transport,
) : HostBackend {
  override val kind = HostBackendKind.Gateway

  override fun events(): Flow<HostEvent> = flow {
    // The current state first, so a collector that joins late still learns it.
    emit(HostEvent.State(transport.state.value))
    transport.events.map {
      when (it) {
        is Transport.Event.StateChanged -> HostEvent.State(it.state)
        is Transport.Event.Message -> HostEvent.Event(it.envelope)
        is Transport.Event.Media -> HostEvent.Media(it.data)
      }
    }.collect { emit(it) }
  }

  override suspend fun <P, R> request(command: RemoteCommand<P, R>, params: P): R = transport.request(command, params)

  override suspend fun <P, R> sequencedRequest(command: RemoteCommand<P, R>, params: P): Pair<R, Int> =
    transport.sequencedRequest(command, params)

  override suspend fun subscribe(agentId: String, on: Boolean) = transport.subscribe(agentId, on)

  override suspend fun disconnect() {
    transport.disconnect()
    transport.close()
  }
}
