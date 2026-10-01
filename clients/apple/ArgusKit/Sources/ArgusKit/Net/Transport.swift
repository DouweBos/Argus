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
  }

  /// Plaintext tags distinguishing JSON envelopes from binary media frames.
  /// `0x02` is the desktop-to-desktop file transfer channel; a phone never
  /// sends or handles it.
  private static let tagJSON: UInt8 = 0x00
  private static let tagMedia: UInt8 = 0x01

  private static let requestTimeout: Duration = .seconds(15)

  public let url: String
  private let identity: DeviceIdentity
  private let socket: GatewaySocket

  private var handshake: NoiseHandshake?
  private var session: NoiseSession?
  private var sendSeq = 0
  private var recvSeq = -1
  private var pending: [String: CheckedContinuation<ResponseEnvelope, Error>] = [:]
  private var continuation: AsyncStream<Event>.Continuation?
  private var pump: Task<Void, Never>?
  private var lastState: State = .offline

  public init(identity: DeviceIdentity, url: String? = nil) {
    self.identity = identity
    self.url = url ?? identity.url
    let endpoint = URL(string: "\(self.url)/device")!
    self.socket = GatewaySocket(url: endpoint)
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
    handshake = nil
    session = nil
    sendSeq = 0
    recvSeq = -1
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

  private func emit(_ data: Data) async {
    guard let session else { return }
    var plain = Data([Self.tagJSON])
    plain.append(data)
    guard let sealed = try? session.encrypt(plain) else { return }
    await socket.send(sealed)
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
    name: String, _ params: Params, as _: Result.Type = Result.self
  ) async throws -> Result {
    try await send(name, params, as: Result.self)
  }

  private func send<Params: Encodable, Result: Decodable>(
    _ method: String,
    _ params: Params,
    as _: Result.Type
  ) async throws -> Result {
    guard session != nil else { throw TransportError.notReady }
    let id = "r\(sendSeq)"
    let envelope = RequestEnvelope(seq: sendSeq, id: id, method: method, params: params)
    sendSeq += 1
    let data = try ProtocolCodec.encoder.encode(envelope)

    let response = try await withThrowingTaskGroup(of: ResponseEnvelope.self) { group in
      group.addTask { [weak self] in
        guard let self else { throw TransportError.notReady }
        return try await self.awaitResponse(id: id, sending: data)
      }
      group.addTask {
        try await Task.sleep(for: Self.requestTimeout)
        throw TransportError.timedOut
      }
      guard let first = try await group.next() else { throw TransportError.timedOut }
      group.cancelAll()
      return first
    }

    if let error = response.error { throw TransportError.gateway(error) }
    return try ProtocolCodec.convert(response.ok ?? .null, to: Result.self)
  }

  private func awaitResponse(id: String, sending data: Data) async throws -> ResponseEnvelope {
    try await withCheckedThrowingContinuation { continuation in
      pending[id] = continuation
      Task { await emit(data) }
    }
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
    await emit(data)
  }
}
