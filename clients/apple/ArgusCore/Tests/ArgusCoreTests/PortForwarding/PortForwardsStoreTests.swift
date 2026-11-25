import ArgusCore
import Foundation
import Network
import Testing

/// A host whose every port echoes, except `closedPort`.
private actor EchoHost: TunnelOpener {
  struct Refused: Error {}
  static let closedPort = 9
  private var streams: [UInt16: AsyncStream<Data>.Continuation] = [:]
  private var next: UInt16 = 1
  private(set) var opened = 0

  func openTunnel(sessionId _: String, port: Int) async throws -> (id: UInt16, incoming: AsyncStream<Data>) {
    guard port != Self.closedPort else { throw Refused() }
    let id = next
    next += 1
    opened += 1
    let (stream, continuation) = AsyncStream<Data>.makeStream()
    streams[id] = continuation
    return (id, stream)
  }

  func sendTunnel(_ id: UInt16, _ data: Data) async {
    streams[id]?.yield(Data("echo:".utf8) + data)
  }

  func finishTunnel(_ id: UInt16) async { streams.removeValue(forKey: id)?.finish() }
  func closeTunnel(_ id: UInt16) async { streams.removeValue(forKey: id)?.finish() }
}

/// Connects to the forward on this Mac, sends `text` and reads until the server closes.
private func roundTrip(_ port: Int, _ text: String) async throws -> String {
  let connection = NWConnection(
    host: "127.0.0.1", port: NWEndpoint.Port(rawValue: UInt16(port))!, using: .tcp)
  connection.start(queue: .global())
  connection.send(
    content: Data(text.utf8), contentContext: .finalMessage, isComplete: true,
    completion: .idempotent)
  var received = Data()
  while true {
    let (data, done): (Data?, Bool) = try await withCheckedThrowingContinuation { continuation in
      connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, complete, error in
        if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: (data, complete)) }
      }
    }
    if let data { received.append(data) }
    if done { break }
  }
  connection.cancel()
  return String(decoding: received, as: UTF8.self)
}

@MainActor
struct PortForwardsStoreTests {
  @Test func pipesALocalConnectionToTheHost() async throws {
    let host = EchoHost()
    let store = PortForwardsStore { _ in host }
    let key = PortForwardsStore.Key(hostId: "h", sessionId: "s", port: 0)
    let forward = try await store.start(key)
    #expect(forward.localPort > 0)
    #expect(try await roundTrip(forward.localPort, "hi") == "echo:hi")
    store.stop(key)
    #expect(store.forward(key) == nil)
  }

  @Test func refusesAPortNothingListensOn() async {
    let store = PortForwardsStore { _ in EchoHost() }
    let key = PortForwardsStore.Key(hostId: "h", sessionId: "s", port: EchoHost.closedPort)
    await #expect(throws: (any Error).self) { try await store.start(key) }
    #expect(store.forwards.isEmpty)
  }

  @Test func needsAConnectedHost() async {
    let store = PortForwardsStore { _ in nil }
    await #expect(throws: PortForwardsStore.Failure.self) {
      try await store.start(.init(hostId: "h", sessionId: "s", port: 3000))
    }
  }

  @Test func movesToAnotherPortWhenTaken() async throws {
    let host = EchoHost()
    let store = PortForwardsStore { _ in host }
    let first = try await store.start(.init(hostId: "h", sessionId: "s", port: 0))
    let taken = first.localPort
    let second = try await store.start(.init(hostId: "h", sessionId: "other", port: taken))
    #expect(second.localPort != taken)
    #expect(try await roundTrip(second.localPort, "x") == "echo:x")
    store.stop(sessionId: "s")
    #expect(store.forwards.count == 1)
    store.retain(hosts: [])
    #expect(store.forwards.isEmpty)
  }
}
