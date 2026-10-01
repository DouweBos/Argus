import Foundation
import Network

/// The Mac app's channel to the host it supervises: the host's Unix socket
/// (`$ARGUS_HOME/host.sock`, mode 0600). No Noise and no pairing — owning the
/// socket file is the authentication — but the same envelopes and frame tags
/// as the gateway, so everything above this is shared with the phone.
///
/// Frames are length-prefixed (u32 big-endian) because a socket is a stream.
/// Reconnects on its own: the supervisor restarts a crashed host, and the UI
/// should simply come back.
public actor LocalTransport {
  private static let tagJSON: UInt8 = 0x00
  private static let tagMedia: UInt8 = 0x01
  private static let maxFrame = 64 * 1024 * 1024
  private static let requestTimeout: Duration = .seconds(30)
  private static let maxBackoff: Duration = .seconds(5)

  public let path: String
  private let queue = DispatchQueue(label: "argus.local-transport")
  private var connection: NWConnection?
  private var buffer = Data()
  private var sendSeq = 0
  private var recvSeq = -1
  private var pending: [String: CheckedContinuation<ResponseEnvelope, Error>] = [:]
  private var continuation: AsyncStream<Transport.Event>.Continuation?
  private var lastState: Transport.State = .offline
  private var closedByUs = false
  private var backoff: Duration = .milliseconds(200)
  /// Bumped per connection so callbacks from a dead one are ignored.
  private var generation = 0

  public init(path: String) {
    self.path = path
  }

  public var state: Transport.State { lastState }

  /// Begin connecting; the stream lives across reconnects.
  public func start() -> AsyncStream<Transport.Event> {
    let (stream, continuation) = AsyncStream<Transport.Event>.makeStream()
    self.continuation = continuation
    closedByUs = false
    open()
    return stream
  }

  public func disconnect() {
    closedByUs = true
    connection?.cancel()
    connection = nil
    reset()
    setState(.offline)
    continuation?.finish()
    continuation = nil
  }

  private func setState(_ state: Transport.State) {
    guard state != lastState else { return }
    lastState = state
    continuation?.yield(.state(state))
  }

  private func reset() {
    buffer = Data()
    sendSeq = 0
    recvSeq = -1
    for (_, cont) in pending {
      cont.resume(throwing: Transport.TransportError.notReady)
    }
    pending.removeAll()
  }

  private func open() {
    guard !closedByUs else { return }
    generation += 1
    let current = generation
    setState(.connecting)
    let connection = NWConnection(to: .unix(path: path), using: .tcp)
    self.connection = connection
    connection.stateUpdateHandler = { [weak self] state in
      Task { await self?.onState(state, generation: current) }
    }
    connection.start(queue: queue)
  }

  private func onState(_ state: NWConnection.State, generation current: Int) {
    guard current == generation else { return }
    switch state {
    case .ready:
      backoff = .milliseconds(200)
      setState(.ready)
      receive(generation: current)
    case .failed, .cancelled, .waiting:
      dropped(generation: current)
    default:
      break
    }
  }

  private func dropped(generation current: Int) {
    guard current == generation, !closedByUs else { return }
    connection?.cancel()
    connection = nil
    reset()
    setState(.offline)
    let delay = backoff
    backoff = min(backoff * 2, Self.maxBackoff)
    Task { [weak self] in
      try? await Task.sleep(for: delay)
      await self?.reopen(after: current)
    }
  }

  private func reopen(after current: Int) {
    guard current == generation, connection == nil else { return }
    open()
  }

  private func receive(generation current: Int) {
    connection?.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) {
      [weak self] data, _, isComplete, error in
      Task {
        await self?.onReceive(data, isComplete: isComplete, error: error, generation: current)
      }
    }
  }

  private func onReceive(
    _ data: Data?, isComplete: Bool, error: NWError?, generation current: Int
  ) {
    guard current == generation else { return }
    if let data, !data.isEmpty {
      buffer.append(data)
      drainFrames()
    }
    if isComplete || error != nil {
      dropped(generation: current)
      return
    }
    receive(generation: current)
  }

  private func drainFrames() {
    while buffer.count >= 4 {
      let start = buffer.startIndex
      let length = buffer[start..<start + 4].reduce(0) { ($0 << 8) | Int($1) }
      guard length <= Self.maxFrame else {
        dropped(generation: generation)
        return
      }
      guard buffer.count >= 4 + length else { return }
      let frame = buffer[(start + 4)..<(start + 4 + length)]
      buffer = Data(buffer[(start + 4 + length)...])
      handle(Data(frame))
    }
  }

  private func handle(_ plain: Data) {
    guard let tag = plain.first else { return }
    let body = plain.dropFirst()
    if tag == Self.tagMedia {
      continuation?.yield(.media(Data(body)))
      return
    }
    guard tag == Self.tagJSON, let frame = try? ProtocolCodec.decodeFrame(Data(body)) else {
      return
    }
    switch frame {
    case .response(let res):
      guard res.seq > recvSeq else { return }
      recvSeq = res.seq
      pending.removeValue(forKey: res.id)?.resume(returning: res)
    case .event(let evt):
      guard evt.seq > recvSeq else { return }
      recvSeq = evt.seq
      continuation?.yield(.event(evt))
    case .unknown:
      break
    }
  }

  private func write(_ json: Data) {
    guard let connection else { return }
    var frame = Data(capacity: 5 + json.count)
    let length = UInt32(1 + json.count).bigEndian
    withUnsafeBytes(of: length) { frame.append(contentsOf: $0) }
    frame.append(Self.tagJSON)
    frame.append(json)
    connection.send(content: frame, completion: .contentProcessed { _ in })
  }

  // MARK: Requests

  @discardableResult
  public func request<Params: Encodable, Result: Decodable>(
    _ method: RemoteMethod, _ params: Params, as _: Result.Type = Result.self
  ) async throws -> Result {
    try await send(method.rawValue, params, as: Result.self)
  }

  @discardableResult
  public func request<C: RemoteCommand>(_: C.Type, _ params: C.Params) async throws -> C.Result {
    try await send(C.name, params, as: C.Result.self)
  }

  /// A method by name — the local-only `ui.*` methods have no generated type.
  @discardableResult
  public func request<Params: Encodable, Result: Decodable>(
    method: String, _ params: Params, as _: Result.Type = Result.self
  ) async throws -> Result {
    try await send(method, params, as: Result.self)
  }

  private func send<Params: Encodable, Result: Decodable>(
    _ method: String, _ params: Params, as _: Result.Type
  ) async throws -> Result {
    guard lastState == .ready else { throw Transport.TransportError.notReady }
    let id = "r\(sendSeq)"
    let data = try ProtocolCodec.encoder.encode(
      RequestEnvelope(seq: sendSeq, id: id, method: method, params: params))
    sendSeq += 1

    let response = try await withThrowingTaskGroup(of: ResponseEnvelope.self) { group in
      group.addTask { [weak self] in
        guard let self else { throw Transport.TransportError.notReady }
        return try await self.awaitResponse(id: id, sending: data)
      }
      group.addTask {
        try await Task.sleep(for: Self.requestTimeout)
        throw Transport.TransportError.timedOut
      }
      guard let first = try await group.next() else { throw Transport.TransportError.timedOut }
      group.cancelAll()
      return first
    }
    if let error = response.error { throw Transport.TransportError.gateway(error) }
    return try ProtocolCodec.convert(response.ok ?? .null, to: Result.self)
  }

  private func awaitResponse(id: String, sending data: Data) async throws -> ResponseEnvelope {
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        pending[id] = continuation
        write(data)
      }
    } onCancel: {
      Task { await self.cancel(id) }
    }
  }

  private func cancel(_ id: String) {
    pending.removeValue(forKey: id)?.resume(throwing: CancellationError())
  }

  public func subscribe(agentId: String, on: Bool) {
    guard lastState == .ready else { return }
    let envelope = SubscribeEnvelope(
      seq: sendSeq, action: on ? "subscribe" : "unsubscribe", agentId: agentId)
    sendSeq += 1
    guard let data = try? ProtocolCodec.encoder.encode(envelope) else { return }
    write(data)
  }
}
