import Foundation
import Network
import Testing

@testable import ArgusKit

/// A real WebSocket server on loopback, answering pings or not.
private final class PingServer: @unchecked Sendable {
  let listener: NWListener
  private let queue = DispatchQueue(label: "ping-server")
  private var connections: [NWConnection] = []

  init(answersPings: Bool) throws {
    let ws = NWProtocolWebSocket.Options()
    ws.autoReplyPing = answersPings
    let params = NWParameters.tcp
    params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
    listener = try NWListener(using: params, on: .any)
    listener.newConnectionHandler = { [weak self] connection in
      guard let self else { return }
      self.connections.append(connection)
      connection.start(queue: self.queue)
      self.drain(connection)
    }
  }

  /// Keep reading so the server sees (and, if asked, answers) control frames.
  private func drain(_ connection: NWConnection) {
    connection.receiveMessage { [weak self] _, _, _, error in
      guard error == nil else { return }
      self?.drain(connection)
    }
  }

  func start() async -> UInt16 {
    await withCheckedContinuation { continuation in
      listener.stateUpdateHandler = { [listener] state in
        if case .ready = state, let port = listener.port?.rawValue {
          listener.stateUpdateHandler = nil
          continuation.resume(returning: port)
        }
      }
      listener.start(queue: queue)
    }
  }

  func stop() {
    listener.cancel()
    queue.sync { for connection in connections { connection.cancel() } }
  }
}

@Suite struct GatewaySocketKeepaliveTests {
  /// Whether the socket reported `.closed` within `window`.
  private func closes(answersPings: Bool, within window: Duration) async throws -> Bool {
    let server = try PingServer(answersPings: answersPings)
    let port = await server.start()
    defer { server.stop() }
    let socket = GatewaySocket(
      url: URL(string: "ws://127.0.0.1:\(port)/device")!,
      pingInterval: .milliseconds(200), pongTimeout: .milliseconds(400))
    let events = await socket.connect()
    defer { Task { await socket.close() } }

    return await withTaskGroup(of: Bool.self) { group in
      group.addTask {
        for await event in events {
          if case .closed = event { return true }
        }
        return false
      }
      group.addTask {
        try? await Task.sleep(for: window)
        return false
      }
      let first = await group.next() ?? false
      group.cancelAll()
      await socket.close()
      return first
    }
  }

  @Test func dropsASocketThatStopsAnsweringPings() async throws {
    #expect(try await closes(answersPings: false, within: .seconds(5)))
  }

  @Test func keepsAnIdleSocketThatAnswersPings() async throws {
    #expect(try await !closes(answersPings: true, within: .seconds(2)))
  }
}
