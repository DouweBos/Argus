import ArgusKit
import Foundation
import Network
import Synchronization

/// What a forward needs from a host connection: one tunnel per TCP connection.
public protocol TunnelOpener: Sendable {
  func openTunnel(sessionId: String, port: Int) async throws -> (
    id: UInt16, incoming: AsyncStream<Data>
  )
  func sendTunnel(_ id: UInt16, _ data: Data) async
  func finishTunnel(_ id: UInt16) async
  func closeTunnel(_ id: UInt16) async
}

extension Transport: TunnelOpener {}

/// A loopback listener on this machine; every connection it accepts is piped
/// to `remotePort` on the host. It outlives reconnects: each new connection
/// asks `opener` for whatever link is current.
final class PortForwarder: Sendable {
  enum Failure: Error { case portInUse }

  let localPort: Int
  private let listeners: [NWListener]
  private let connections = Mutex<[ObjectIdentifier: NWConnection]>([:])
  private static let queue = DispatchQueue(label: "dev.houwert.argus.port-forward")

  private init(listeners: [NWListener], localPort: Int) {
    self.listeners = listeners
    self.localPort = localPort
  }

  /// Listens on `preferredPort` when it is free, any free port otherwise.
  static func start(
    preferredPort: Int, sessionId: String, remotePort: Int,
    opener: @escaping @Sendable () async -> (any TunnelOpener)?
  ) async throws -> PortForwarder {
    let accept = AcceptBox()
    let (listeners, port): ([NWListener], Int)
    do {
      (listeners, port) = try await bindLoopback(port: preferredPort, accept: accept)
    } catch Failure.portInUse {
      (listeners, port) = try await bindLoopback(port: 0, accept: accept)
    }
    let forwarder = PortForwarder(listeners: listeners, localPort: port)
    accept.handler.withLock {
      $0 = { [weak forwarder] connection in
        guard let forwarder else { return connection.cancel() }
        forwarder.accept(connection, sessionId: sessionId, remotePort: remotePort, opener: opener)
      }
    }
    return forwarder
  }

  func stop() {
    for listener in listeners { listener.cancel() }
    let open = connections.withLock { open in
      defer { open.removeAll() }
      return Array(open.values)
    }
    for connection in open { connection.cancel() }
  }

  // MARK: Connections

  private func accept(
    _ connection: NWConnection, sessionId: String, remotePort: Int,
    opener: @escaping @Sendable () async -> (any TunnelOpener)?
  ) {
    let key = ObjectIdentifier(connection)
    connections.withLock { $0[key] = connection }
    connection.start(queue: Self.queue)
    Task {
      defer { _ = self.connections.withLock { $0.removeValue(forKey: key) } }
      guard let tunnels = await opener(),
        let (id, incoming) = try? await tunnels.openTunnel(sessionId: sessionId, port: remotePort)
      else { return connection.cancel() }
      let upstream = Task { await Self.readLoop(connection, tunnels, id) }
      for await chunk in incoming {
        guard await Self.write(connection, chunk) else { break }
      }
      connection.send(
        content: nil, contentContext: .finalMessage, isComplete: true,
        completion: .contentProcessed { _ in connection.cancel() })
      upstream.cancel()
      await tunnels.closeTunnel(id)
    }
  }

  private static func readLoop(
    _ connection: NWConnection, _ tunnels: any TunnelOpener, _ id: UInt16
  ) async {
    while !Task.isCancelled {
      let (data, complete, failed) = await read(connection)
      if let data, !data.isEmpty { await tunnels.sendTunnel(id, data) }
      if failed { return await tunnels.closeTunnel(id) }
      if complete { return await tunnels.finishTunnel(id) }
    }
  }

  private static func read(_ connection: NWConnection) async -> (Data?, Bool, Bool) {
    await withCheckedContinuation { continuation in
      connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) {
        data, _, complete, error in
        continuation.resume(returning: (data, complete, error != nil))
      }
    }
  }

  /// Waits for the bytes to leave, so a slow browser slows the tunnel down.
  private static func write(_ connection: NWConnection, _ data: Data) async -> Bool {
    await withCheckedContinuation { continuation in
      connection.send(
        content: data,
        completion: .contentProcessed { error in continuation.resume(returning: error == nil) })
    }
  }

  // MARK: Binding

  final class AcceptBox: Sendable {
    let handler = Mutex<(@Sendable (NWConnection) -> Void)?>(nil)
  }

  /// 127.0.0.1, on a port nothing on this Mac holds on ::1 either — a local
  /// server there would otherwise answer `localhost` in the forward's place.
  private static func bindLoopback(port: Int, accept: AcceptBox) async throws -> (
    [NWListener], Int
  ) {
    if port != 0 {
      guard !heldOnIPv6Loopback(port) else { throw Failure.portInUse }
      let listener = try await listen(.ipv4(.loopback), port: port, accept: accept)
      return ([listener], port)
    }
    for _ in 0..<8 {
      let listener = try await listen(.ipv4(.loopback), port: 0, accept: accept)
      let bound = Int(listener.port?.rawValue ?? 0)
      if bound > 0, !heldOnIPv6Loopback(bound) { return ([listener], bound) }
      listener.cancel()
    }
    throw Failure.portInUse
  }

  private static func heldOnIPv6Loopback(_ port: Int) -> Bool {
    let fd = socket(AF_INET6, SOCK_STREAM, 0)
    guard fd >= 0 else { return false }
    defer { close(fd) }
    var address = sockaddr_in6()
    address.sin6_len = UInt8(MemoryLayout<sockaddr_in6>.size)
    address.sin6_family = sa_family_t(AF_INET6)
    address.sin6_port = UInt16(port).bigEndian
    address.sin6_addr = in6addr_loopback
    let result = withUnsafePointer(to: &address) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in6>.size))
      }
    }
    return result != 0 && errno == EADDRINUSE
  }

  private static func listen(_ host: NWEndpoint.Host, port: Int, accept: AcceptBox)
    async throws -> NWListener
  {
    let parameters = NWParameters.tcp
    parameters.requiredLocalEndpoint = .hostPort(
      host: host, port: NWEndpoint.Port(rawValue: UInt16(port)) ?? .any)
    let listener = try NWListener(using: parameters)
    listener.newConnectionHandler = { connection in
      if let handler = accept.handler.withLock({ $0 }) {
        handler(connection)
      } else {
        connection.cancel()
      }
    }
    let resumed = Mutex(false)
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      listener.stateUpdateHandler = { state in
        let result: Result<Void, Error>? =
          switch state {
          case .ready: .success(())
          case .failed(let error), .waiting(let error):
            .failure(error == .posix(.EADDRINUSE) ? Failure.portInUse : error)
          default: nil
          }
        guard let result, resumed.withLock({ done in defer { done = true }; return !done })
        else { return }
        if case .failure = result { listener.cancel() }
        continuation.resume(with: result)
      }
      listener.start(queue: queue)
    }
    return listener
  }
}
