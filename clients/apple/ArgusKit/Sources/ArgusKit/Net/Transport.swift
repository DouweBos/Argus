import Foundation

/// Steady-state client transport: connects to the gateway's `/device`
/// endpoint, runs the Noise IK initiator handshake against the pinned desktop
/// key, then exposes request/response plus event subscription over the
/// encrypted channel. No rooms — the desktop identifies this device by its
/// static key.
public actor Transport {
  public enum State: String, Sendable {
    case connecting, handshaking, offline, ready
  }

  public enum Event: Sendable {
    case state(State)
    case event(EventEnvelope)
    /// A binary device-screen frame, after the media tag byte.
    case media(Data)
  }

  public enum TransportError: Error {
    case notReady
    case timedOut
    case badIdentity
    case gateway(GatewayErrorPayload)
    /// The host has no such method: it runs an older Argus than this client.
    case unsupported(method: String, hostVersion: String?)
  }

  /// Plaintext tags distinguishing JSON envelopes from binary media frames.
  /// `0x02` is the desktop-to-desktop file transfer channel; a phone never
  /// sends or handles it.
  private static let tagJSON: UInt8 = 0x00
  private static let tagMedia: UInt8 = 0x01

  public static let requestTimeout: Duration = .seconds(15)

  public let url: String
  private let identity: DeviceIdentity
  private let socket: GatewaySocket

  private var handshake: NoiseHandshake?
  private var session: NoiseSession?
  /// The host's app version once asked; `.some(nil)` while asking or unknown.
  private var hostVersion: String??
  private var sendSeq = 0
  private var recvSeq = -1
  private var pending: [String: CheckedContinuation<ResponseEnvelope, Error>] = [:]
  private var continuation: AsyncStream<Event>.Continuation?
  private var pump: Task<Void, Never>?
  private var lastState: State = .offline
  /// Sealed frames in the order they were numbered and encrypted: the gateway
  /// drops a frame whose `seq` is behind the last one, and Noise needs nonce
  /// order, so they reach the socket one at a time, first in first out.
  private var outbox: AsyncStream<Data>.Continuation
  private var writer: Task<Void, Never>

  public init(identity: DeviceIdentity, url: String? = nil) {
    self.identity = identity
    self.url = url ?? identity.url
    let endpoint = URL(string: "\(self.url)/device")!
    self.socket = GatewaySocket(url: endpoint)
    (outbox, writer) = Self.makeWriter(socket)
  }

  private static func makeWriter(_ socket: GatewaySocket) -> (AsyncStream<Data>.Continuation, Task<Void, Never>) {
    let (frames, outbox) = AsyncStream<Data>.makeStream()
    let writer = Task {
      for await frame in frames { await socket.send(frame) }
    }
    return (outbox, writer)
  }

  public var state: State { lastState }

  private func openSocket() async -> AsyncStream<GatewaySocket.Event> {
    await socket.connect()
  }

  public func start() -> AsyncStream<Event> {
    let (stream, continuation) = AsyncStream<Event>.makeStream()
    self.continuation = continuation
    setState(.connecting)
    pump = Task { [weak self] in
      guard let self else { return }
      for await event in await self.openSocket() {
        await self.handle(event)
      }
    }
    return stream
  }

  /// Hand this live transport to a new owner, returning its fresh event stream.
  ///
  /// Endpoint probing connects several transports and keeps one; the winner's
  /// Noise session is already established, so only the sink is swapped. Events
  /// that arrived mid-probe are dropped — the new owner resubscribes to
  /// whatever it cares about.
  public func resubscribe() -> AsyncStream<Event> {
    let (stream, continuation) = AsyncStream<Event>.makeStream()
    self.continuation?.finish()
    self.continuation = continuation
    return stream
  }

  public func disconnect() async {
    pump?.cancel()
    pump = nil
    await socket.close()
    reset()
    continuation?.finish()
    continuation = nil
  }

  private func setState(_ state: State) {
    lastState = state
    continuation?.yield(.state(state))
  }

  private func reset() {
    hostVersion = nil
    handshake = nil
    session = nil
    sendSeq = 0
    recvSeq = -1
    // Frames sealed for the old session mean nothing to the next one.
    writer.cancel()
    outbox.finish()
    (outbox, writer) = Self.makeWriter(socket)
    for (_, cont) in pending {
      cont.resume(throwing: TransportError.notReady)
    }
    pending.removeAll()
  }

  private func handle(_ event: GatewaySocket.Event) async {
    switch event {
    case .open:
      await startHandshake()
    case .frame(let data):
      await onData(data)
    case .closed:
      reset()
      setState(.offline)
    }
  }

  private func startHandshake() async {
    setState(.handshaking)
    guard let keypair = identity.keypair, let remote = identity.desktopStaticKey else {
      setState(.offline)
      return
    }
    do {
      let hs = try NoiseHandshake(
        NoiseHandshakeConfig(role: .initiator, staticKey: keypair, remoteStatic: remote))
      handshake = hs
      await socket.send(try hs.writeMessage(Data()))
    } catch {
      reset()
      setState(.offline)
    }
  }

  private func onData(_ bytes: Data) async {
    if session == nil {
      guard let hs = handshake else { return }
      do {
        _ = try hs.readMessage(bytes)
        session = try hs.session()
        setState(.ready)
      } catch {
        // Only the real desktop holds the pinned key, so a failure here means
        // this is not it. Drop the connection rather than retrying blind.
        reset()
        setState(.offline)
      }
      return
    }

    guard let session, let plain = try? session.decrypt(bytes), !plain.isEmpty else {
      return
    }
    let tag = plain[plain.startIndex]
    let body = plain.dropFirst()
    if tag == Self.tagMedia {
      continuation?.yield(.media(Data(body)))
      return
    }
    guard tag == Self.tagJSON,
      let frame = try? ProtocolCodec.decodeFrame(Data(body))
    else { return }

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

  /// Seals now, in numbering order, and queues the frame for the writer.
  private func emit(_ data: Data) {
    guard let session else { return }
    var plain = Data([Self.tagJSON])
    plain.append(data)
    guard let sealed = try? session.encrypt(plain) else { return }
    outbox.yield(sealed)
  }

  @discardableResult
  public func request<Params: Encodable, Result: Decodable>(
    _ method: RemoteMethod,
    _ params: Params,
    as _: Result.Type = Result.self
  ) async throws -> Result {
    try await send(method.rawValue, params, as: Result.self)
  }

  /// A generated command: params and result are typed by the host's catalog.
  @discardableResult
  public func request<C: RemoteCommand>(
    _ command: C.Type,
    _ params: C.Params
  ) async throws -> C.Result {
    try await send(C.name, params, as: C.Result.self)
  }

  /// A request by wire name, for callers that hold the name rather than the
  /// command type.
  @discardableResult
  public func request<Params: Encodable & Sendable, Result: Decodable & Sendable>(
    name: String, _ params: Params, as _: Result.Type = Result.self,
    timeout: Duration = Transport.requestTimeout
  ) async throws -> Result {
    try await send(name, params, as: Result.self, timeout: timeout)
  }

  /// A request plus the response's place in this connection's sequence of
  /// events and responses, so a snapshot can be stitched onto later events.
  public func sequencedRequest<Params: Encodable & Sendable, Result: Decodable & Sendable>(
    name: String, _ params: Params, as _: Result.Type
  ) async throws -> (result: Result, seq: Int) {
    let response = try await exchange(name, params, timeout: Self.requestTimeout)
    return (try ProtocolCodec.convert(response.ok ?? .null, to: Result.self), response.seq)
  }

  private func send<Params: Encodable, Result: Decodable>(
    _ method: String,
    _ params: Params,
    as _: Result.Type,
    timeout: Duration = Transport.requestTimeout
  ) async throws -> Result {
    let response = try await exchange(method, params, timeout: timeout)
    return try ProtocolCodec.convert(response.ok ?? .null, to: Result.self)
  }

  private func exchange<Params: Encodable>(
    _ method: String, _ params: Params, timeout: Duration
  ) async throws -> ResponseEnvelope {
    guard session != nil else { throw TransportError.notReady }
    let json = try ProtocolCodec.decoder.decode(JSONValue.self, from: ProtocolCodec.encoder.encode(params))

    let response = try await withThrowingTaskGroup(of: ResponseEnvelope.self) { group in
      group.addTask { [weak self] in
        guard let self else { throw TransportError.notReady }
        return try await self.awaitResponse(method, json)
      }
      group.addTask {
        try await Task.sleep(for: timeout)
        throw TransportError.timedOut
      }
      guard let first = try await group.next() else { throw TransportError.timedOut }
      group.cancelAll()
      return first
    }

    if let error = response.error {
      guard let method = error.unsupportedMethod else { throw TransportError.gateway(error) }
      throw TransportError.unsupported(method: method, hostVersion: await knownHostVersion())
    }
    return response
  }

  /// Asked once per connection, the first time the host turns out too old.
  private func knownHostVersion() async -> String? {
    if let hostVersion { return hostVersion }
    hostVersion = .some(nil)
    let response = try? await exchange(
      TransportError.versionCommand, EmptyParams(), timeout: Self.requestTimeout)
    let version = response?.ok?.stringValue
    hostVersion = version
    return version
  }

  /// Cancellable, so a timed-out request doesn't keep its task group waiting.
  /// Numbered in the same actor turn it's sealed in, so `seq` follows send order.
  private func awaitResponse(_ method: String, _ params: JSONValue) async throws -> ResponseEnvelope {
    let id = "r\(sendSeq)"
    let envelope = RequestEnvelope(seq: sendSeq, id: id, method: method, params: params)
    sendSeq += 1
    let data = try ProtocolCodec.encoder.encode(envelope)
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        pending[id] = continuation
        emit(data)
      }
    } onCancel: {
      Task { await self.cancel(id) }
    }
  }

  private func cancel(_ id: String) {
    pending.removeValue(forKey: id)?.resume(throwing: CancellationError())
  }

  /// Subscriptions are per agent and gate which `agent.*` / `permission.*`
  /// events reach this connection. The gateway replays pending permission
  /// requests on subscribe, which is what makes offline decisions replayable.
  public func subscribe(agentId: String, on: Bool) async {
    guard session != nil else { return }
    let envelope = SubscribeEnvelope(
      seq: sendSeq, action: on ? "subscribe" : "unsubscribe", agentId: agentId)
    sendSeq += 1
    guard let data = try? ProtocolCodec.encoder.encode(envelope) else { return }
    emit(data)
  }
}
