import Foundation

/// The Mac app's backend: the host it supervises, over `LocalTransport`.
///
/// The socket's connection is the console — every tier, typed events plus raw
/// `ipc` broadcasts — so the shared stores work unchanged and Mac-only views
/// can still reach the host's own channels.
public final class LocalBackend: HostBackend {
  public let kind = HostBackendKind.local
  public let transport: LocalTransport
  private let onPlatformRequest: @Sendable (EventEnvelope) -> Void

  /// `onPlatformRequest` gets the host's `platform.request` events — banners,
  /// opening URLs, raising the window — which are the app's to answer, not a
  /// store's.
  public init(
    socketPath: String, onPlatformRequest: @escaping @Sendable (EventEnvelope) -> Void = { _ in }
  ) {
    transport = LocalTransport(path: socketPath)
    self.onPlatformRequest = onPlatformRequest
  }

  public func events() async -> AsyncStream<HostEvent> {
    let upstream = await transport.start()
    let onPlatformRequest = onPlatformRequest
    return AsyncStream { continuation in
      let pump = Task {
        for await event in upstream {
          switch event {
          case .state(let state): continuation.yield(.state(state))
          case .event(let envelope) where envelope.event == "platform.request":
            onPlatformRequest(envelope)
          case .event(let envelope): continuation.yield(.event(envelope))
          case .media(let data): continuation.yield(.media(data))
          }
        }
        continuation.finish()
      }
      continuation.onTermination = { _ in pump.cancel() }
    }
  }

  public func request<Params: Encodable & Sendable, Result: Decodable & Sendable>(
    _ method: RemoteMethod, _ params: Params, as: Result.Type
  ) async throws -> Result {
    try await transport.request(method, params, as: Result.self)
  }

  /// By wire name: handing the command's metatype across the actor boundary
  /// trips Swift 6's sending checks.
  public func request<C: RemoteCommand>(_ command: C.Type, _ params: C.Params) async throws
    -> C.Result
  {
    try await transport.request(method: C.name, params, as: C.Result.self)
  }

  /// A command plus where its response falls among the host's events.
  public func sequencedRequest<C: RemoteCommand>(_ command: C.Type, _ params: C.Params)
    async throws -> (result: C.Result, seq: Int)
  {
    try await transport.sequencedRequest(method: C.name, params, as: C.Result.self)
  }

  public func sequencedRequest<Params: Encodable & Sendable, Result: Decodable & Sendable>(
    _ method: RemoteMethod, _ params: Params, as: Result.Type
  ) async throws -> (result: Result, seq: Int) {
    try await transport.sequencedRequest(method: method.rawValue, params, as: Result.self)
  }

  /// A local-only `ui.*` method.
  public func request<Params: Encodable & Sendable, Result: Decodable & Sendable>(
    method: String, _ params: Params, as: Result.Type
  ) async throws -> Result {
    try await transport.request(method: method, params, as: Result.self)
  }

  public func subscribe(agentId: String, on: Bool) async {
    await transport.subscribe(agentId: agentId, on: on)
  }

  public func disconnect() async {
    await transport.disconnect()
  }
}
