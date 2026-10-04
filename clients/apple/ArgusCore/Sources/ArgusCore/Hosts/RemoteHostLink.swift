import ArgusKit
import Foundation
import Synchronization

/// One paired host this Mac drives, over the Noise gateway as an admin device.
///
/// The socket reconnects on its own; every time the session comes back the
/// link asks for the typed event dialect again and re-subscribes, since both
/// belong to a connection.
public final class RemoteHostLink: Sendable {
  public enum Event: Sendable {
    case state(Transport.State)
    case event(EventEnvelope)
    case media(Data)
  }

  public let hostId: HostId
  public let identity: DeviceIdentity
  private let transport: Transport
  private let subscriptions = Mutex<Set<String>>([])
  private let current = Mutex<Transport.State>(.ready)
  private let pump = Mutex<Task<Void, Never>?>(nil)

  /// Dial every known address and keep the one that completes the handshake.
  public static func connect(identity: DeviceIdentity) async throws -> (RemoteHostLink, String) {
    let attempt = try await EndpointRacer.connectBest(identity: identity)
    return (RemoteHostLink(identity: identity, transport: attempt.transport), attempt.url)
  }

  init(identity: DeviceIdentity, transport: Transport) {
    hostId = identity.deviceId
    self.identity = identity
    self.transport = transport
  }

  public var state: Transport.State { current.withLock { $0 } }
  public var isReady: Bool { state == .ready }

  /// Start delivering this host's events. The connection is already up, so
  /// the first `ready` is announced here rather than by the socket.
  public func start(_ sink: @escaping @Sendable (Event) -> Void) async {
    let stream = await transport.resubscribe()
    await configure()
    sink(.state(.ready))
    let task = Task { [weak self] in
      for await event in stream {
        guard let self else { return }
        switch event {
        case .state(let state):
          self.current.withLock { $0 = state }
          if state == .ready { await self.configure() }
          sink(.state(state))
        case .event(let envelope): sink(.event(envelope))
        case .media(let data): sink(.media(data))
        }
      }
    }
    pump.withLock { $0 = task }
  }

  /// What a fresh connection needs: the console's event shaping, and the
  /// subscriptions the last one had.
  private func configure() async {
    struct Params: Encodable { let on: Bool }
    _ = try? await transport.request(
      name: "connection.typed_events", Params(on: true), as: IgnoredResult.self)
    for scope in subscriptions.withLock({ $0 }) {
      await transport.subscribe(agentId: scope, on: true)
    }
  }

  public func request(
    _ method: String, _ params: JSONValue, timeout: Duration = Transport.requestTimeout
  ) async throws -> JSONValue {
    try await transport.request(name: method, params, as: JSONValue.self, timeout: timeout)
  }

  public func sequencedRequest(_ method: String, _ params: JSONValue) async throws
    -> (result: JSONValue, seq: Int)
  {
    try await transport.sequencedRequest(name: method, params, as: JSONValue.self)
  }

  public func subscribe(_ scope: String, on: Bool) async {
    subscriptions.withLock { set in
      if on { set.insert(scope) } else { set.remove(scope) }
    }
    await transport.subscribe(agentId: scope, on: on)
  }

  public func disconnect() async {
    pump.withLock { $0?.cancel() }
    current.withLock { $0 = .offline }
    await transport.disconnect()
  }
}
