import Foundation

/// The phone's link to a paired computer: a live Noise `Transport` behind the
/// transport-neutral `HostBackend` the stores talk to.
public final class GatewayBackend: HostBackend {
  public let transport: Transport

  /// `transport` is already connected — endpoint racing hands over the winner.
  public init(transport: Transport) {
    self.transport = transport
  }

  public var kind: HostBackendKind { .gateway }

  public func events() async -> AsyncStream<HostEvent> {
    let upstream = await transport.resubscribe()
    let (stream, continuation) = AsyncStream<HostEvent>.makeStream()
    let task = Task {
      for await event in upstream {
        switch event {
        case .state(let state): continuation.yield(.state(state))
        case .event(let envelope): continuation.yield(.event(envelope))
        case .media(let data): continuation.yield(.media(data))
        }
      }
      continuation.finish()
    }
    continuation.onTermination = { _ in task.cancel() }
    return stream
  }

  public func request<Params: Encodable & Sendable, Result: Decodable & Sendable>(
    _ method: RemoteMethod, _ params: Params, as: Result.Type
  ) async throws -> Result {
    try await transport.request(method, params, as: Result.self)
  }

  public func request<C: RemoteCommand>(_ command: C.Type, _ params: C.Params) async throws
    -> C.Result
  {
    // By name: the command type itself needn't cross into the transport actor.
    try await transport.request(name: C.name, params, as: C.Result.self)
  }

  public func sequencedRequest<Params: Encodable & Sendable, Result: Decodable & Sendable>(
    _ method: RemoteMethod, _ params: Params, as: Result.Type
  ) async throws -> (result: Result, seq: Int) {
    try await transport.sequencedRequest(name: method.rawValue, params, as: Result.self)
  }

  public func subscribe(agentId: String, on: Bool) async {
    await transport.subscribe(agentId: agentId, on: on)
  }

  public func disconnect() async {
    await transport.disconnect()
  }
}
