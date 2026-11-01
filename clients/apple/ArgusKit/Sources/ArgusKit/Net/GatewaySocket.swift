import Foundation

/// A binary WebSocket to the desktop gateway, carrying raw Noise frames.
///
/// Reconnects on its own with exponential backoff (1 s, doubling, capped at
/// 30 s, reset on a successful open) because the phone loses the network
/// constantly and every drop would otherwise need the UI to intervene.
/// Text frames are ignored — everything real is binary.
///
/// Pings while open: an idle socket is what NATs and tunnels drop first, and a
/// ping nobody answers is how a dead one is noticed rather than waited on.
public actor GatewaySocket {
  public enum Event: Sendable {
    case open
    case frame(Data)
    case closed
  }

  private let url: URL
  private let session: URLSession
  private var task: URLSessionWebSocketTask?
  private var continuation: AsyncStream<Event>.Continuation?
  private var closedByUs = false
  private var backoff: Duration = .seconds(1)
  private var receiveLoop: Task<Void, Never>?
  private var reconnectTask: Task<Void, Never>?
  private var keepalive: Task<Void, Never>?
  private let pingInterval: Duration
  private let pongTimeout: Duration

  private static let maxBackoff: Duration = .seconds(30)
  /// `MAX_PAYLOAD` in the host's `localGatewayServer.ts`.
  private static let maxMessageSize = 16 * 1024 * 1024

  public init(
    url: URL, session: URLSession = .shared,
    pingInterval: Duration = .seconds(25), pongTimeout: Duration = .seconds(15)
  ) {
    self.url = url
    self.session = session
    self.pingInterval = pingInterval
    self.pongTimeout = pongTimeout
  }

  /// Begin connecting. The returned stream lives across reconnects, emitting
  /// `.open` / `.closed` each cycle.
  public func connect() -> AsyncStream<Event> {
    closedByUs = false
    let (stream, continuation) = AsyncStream<Event>.makeStream()
    self.continuation = continuation
    open()
    return stream
  }

  public func close() {
    closedByUs = true
    reconnectTask?.cancel()
    reconnectTask = nil
    receiveLoop?.cancel()
    receiveLoop = nil
    keepalive?.cancel()
    keepalive = nil
    task?.cancel(with: .goingAway, reason: nil)
    task = nil
    continuation?.finish()
    continuation = nil
  }

  public func send(_ data: Data) async {
    guard let task else { return }
    do {
      try await task.send(.data(data))
    } catch {
      drop(task)
    }
  }

  /// Ping now rather than at the next interval — the app is back in the
  /// foreground and the socket may have died while it was suspended.
  public func checkAlive() async {
    guard let task else { return }
    await ping(task)
  }

  private func open() {
    guard !closedByUs else { return }
    let task = session.webSocketTask(with: url)
    // URLSession's 1 MiB default drops the socket on a long transcript page;
    // match the gateway's own frame ceiling instead.
    task.maximumMessageSize = Self.maxMessageSize
    self.task = task
    task.resume()
    // URLSession has no "did open" callback without a delegate, and the first
    // successful receive is a stronger signal anyway — but the handshake has to
    // be written before anything arrives, so treat resume() as open.
    backoff = .seconds(1)
    continuation?.yield(.open)
    receiveLoop = Task { [weak self] in
      await self?.receive(on: task)
    }
    keepalive = Task { [weak self, pingInterval] in
      while !Task.isCancelled {
        try? await Task.sleep(for: pingInterval)
        guard !Task.isCancelled, let self, await self.ping(task) else { return }
      }
    }
  }

  /// Whether `task` answered in time; one that didn't is dropped.
  @discardableResult
  private func ping(_ task: URLSessionWebSocketTask) async -> Bool {
    let answered = await Self.pong(task, within: pongTimeout)
    if !answered { drop(task) }
    return answered
  }

  private static func pong(_ task: URLSessionWebSocketTask, within timeout: Duration) async -> Bool {
    let once = Once()
    return await withCheckedContinuation { continuation in
      once.arm(continuation)
      task.sendPing { error in once.resume(error == nil) }
      Task {
        try? await Task.sleep(for: timeout)
        once.resume(false)
      }
    }
  }

  private func receive(on task: URLSessionWebSocketTask) async {
    while !Task.isCancelled {
      do {
        let message = try await task.receive()
        if case .data(let data) = message {
          continuation?.yield(.frame(data))
        }
        // Text frames are never part of this protocol; drop them silently.
      } catch {
        drop(task)
        return
      }
    }
  }

  /// `dead` failed. Only the current socket drives a reconnect: a stale one
  /// failing late must not tear down the connection that replaced it.
  private func drop(_ dead: URLSessionWebSocketTask) {
    guard dead === task else {
      dead.cancel(with: .goingAway, reason: nil)
      return
    }
    handleClose()
  }

  private func handleClose() {
    guard !closedByUs else { return }
    receiveLoop?.cancel()
    receiveLoop = nil
    keepalive?.cancel()
    keepalive = nil
    task?.cancel(with: .goingAway, reason: nil)
    task = nil
    continuation?.yield(.closed)
    scheduleReconnect()
  }

  private func scheduleReconnect() {
    guard reconnectTask == nil else { return }
    let delay = backoff
    backoff = min(backoff * 2, Self.maxBackoff)
    reconnectTask = Task { [weak self] in
      try? await Task.sleep(for: delay)
      guard !Task.isCancelled else { return }
      await self?.clearReconnectAndOpen()
    }
  }

  private func clearReconnectAndOpen() {
    reconnectTask = nil
    open()
  }
}

/// Resumes a continuation once: a pong and its deadline race to answer.
private final class Once: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<Bool, Never>?

  func arm(_ continuation: CheckedContinuation<Bool, Never>) {
    lock.withLock { self.continuation = continuation }
  }

  func resume(_ value: Bool) {
    lock.withLock {
      continuation?.resume(returning: value)
      continuation = nil
    }
  }
}
