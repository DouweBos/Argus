import ArgusKit
import Foundation
import Observation

/// Ports on a paired host forwarded to this Mac's localhost, by session.
///
/// Each forward is a loopback listener here; its connections ride the host's
/// encrypted gateway connection as tunnels. A forward ends with its session,
/// with its host being detached, or when stopped.
@MainActor @Observable
public final class PortForwardsStore {
  public struct Key: Hashable, Sendable {
    public let hostId: HostId
    public let sessionId: String
    public let port: Int

    public init(hostId: HostId, sessionId: String, port: Int) {
      self.hostId = hostId
      self.sessionId = sessionId
      self.port = port
    }
  }

  public struct Forward: Hashable, Sendable {
    public let key: Key
    /// Usually `key.port`; another one when that is taken on this Mac.
    public let localPort: Int
    public var url: URL { URL(string: "http://localhost:\(localPort)")! }
  }

  public enum Failure: LocalizedError {
    case hostUnavailable

    public var errorDescription: String? {
      switch self {
      case .hostUnavailable: "The host isn't connected"
      }
    }
  }

  public private(set) var forwards: [Key: Forward] = [:]
  /// Being bound now, so a second click doesn't race the first.
  public private(set) var starting: Set<Key> = []
  @ObservationIgnored private var forwarders: [Key: PortForwarder] = [:]
  /// The current connection to a host, or nil while it is down.
  @ObservationIgnored public var tunnels: @MainActor (HostId) -> (any TunnelOpener)?

  public init(tunnels: @escaping @MainActor (HostId) -> (any TunnelOpener)? = { _ in nil }) {
    self.tunnels = tunnels
  }

  public func forward(_ key: Key) -> Forward? { forwards[key] }

  /// Forward `key.port` to this Mac, checking first that the host has
  /// something listening there.
  @discardableResult
  public func start(_ key: Key) async throws -> Forward {
    if let existing = forwards[key] { return existing }
    guard !starting.contains(key) else { throw CancellationError() }
    starting.insert(key)
    defer { starting.remove(key) }

    guard let opener = tunnels(key.hostId) else { throw Failure.hostUnavailable }
    let probe = try await opener.openTunnel(sessionId: key.sessionId, port: key.port)
    await opener.closeTunnel(probe.id)

    let forwarder = try await PortForwarder.start(
      preferredPort: key.port, sessionId: key.sessionId, remotePort: key.port,
      opener: { [weak self] in await self?.tunnels(key.hostId) })
    let forward = Forward(key: key, localPort: forwarder.localPort)
    forwarders[key] = forwarder
    forwards[key] = forward
    return forward
  }

  public func stop(_ key: Key) {
    forwarders.removeValue(forKey: key)?.stop()
    forwards[key] = nil
  }

  /// The session was deleted.
  public func stop(sessionId: String) {
    for key in forwards.keys where key.sessionId == sessionId { stop(key) }
  }

  /// Hosts no longer attached take their forwards with them.
  public func retain(hosts: Set<HostId>) {
    for key in forwards.keys where !hosts.contains(key.hostId) { stop(key) }
  }

  public func stopAll() {
    for key in forwards.keys { stop(key) }
  }

  #if DEBUG
    /// Stand-in forwards for gallery stories, which have no host to tunnel to.
    public func galleryFill(_ entries: [(Key, localPort: Int)]) {
      forwards = Dictionary(
        entries.map { ($0.0, Forward(key: $0.0, localPort: $0.localPort)) },
        uniquingKeysWith: { a, _ in a })
    }
  #endif
}
