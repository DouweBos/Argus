import Foundation

/// A binary WebSocket to the desktop gateway, carrying raw Noise frames.
///
/// Reconnects on its own with exponential backoff (1 s, doubling, capped at
/// 30 s, reset on a successful open) because the phone loses the network
/// constantly and every drop would otherwise need the UI to intervene.
/// Text frames are ignored — everything real is binary.
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

  private static let maxBackoff: Duration = .seconds(30)

  public init(url: URL, session: URLSession = .shared) {
    self.url = url
    self.session = session
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
      // A failed send means the socket is already gone; the receive loop will
      // notice and drive the reconnect. Nothing useful to do here.
      handleClose()
    }
  }

  private func open() {
    guard !closedByUs else { return }
    let task = session.webSocketTask(with: url)
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
        handleClose()
        return
      }
    }
  }

  private func handleClose() {
    guard !closedByUs else { return }
    receiveLoop?.cancel()
    receiveLoop = nil
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
