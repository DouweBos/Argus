import ArgusCore
import Foundation

/// A `HostBackend` that records every request with its params and answers from
/// a script — a fixed reply per name, or a closure for replies that change.
final class RecordingBackend: HostBackend, @unchecked Sendable {
  struct Failure: Error {}
  struct Call {
    let name: String
    let params: JSONValue
  }

  let kind: HostBackendKind
  private let lock = NSLock()
  private var replies: [String: String] = [:]
  private var dynamic: [String: () -> String] = [:]
  private var failing: Set<String> = []
  private var log: [Call] = []
  private var subs: [(String, Bool)] = []
  private var seq = 0
  private let stream: AsyncStream<HostEvent>
  private let continuation: AsyncStream<HostEvent>.Continuation

  init(kind: HostBackendKind = .local) {
    self.kind = kind
    (stream, continuation) = AsyncStream<HostEvent>.makeStream()
  }

  func reply(_ name: String, _ json: String) { lock.withLock { replies[name] = json } }
  func reply(_ name: String, _ make: @escaping () -> String) { lock.withLock { dynamic[name] = make } }
  func fail(_ name: String) { lock.withLock { _ = failing.insert(name) } }

  var calls: [Call] { lock.withLock { log } }
  func calls(_ name: String) -> [Call] { calls.filter { $0.name == name } }
  var subscriptions: [(String, Bool)] { lock.withLock { subs } }

  // MARK: Pushing events

  func emit(_ event: String, agentId: String? = nil, payload: String) throws {
    let agent = agentId.map { #","agent_id":"\#($0)""# } ?? ""
    let n = lock.withLock { () -> Int in seq += 1; return seq }
    let json = #"{"seq":\#(n),"event":"\#(event)"\#(agent),"payload":\#(payload)}"#
    let envelope = try ProtocolCodec.decoder.decode(EventEnvelope.self, from: Data(json.utf8))
    continuation.yield(.event(envelope))
  }

  /// A raw host broadcast, as the console connection receives it.
  func ipc(_ channel: String, _ args: String) throws {
    try emit("ipc", payload: #"{"channel":"\#(channel)","args":[\#(args)]}"#)
  }

  /// A stream-json line on `agent.event`, which the host forwards as a string.
  func streamEvent(_ agentId: String, _ event: String) throws {
    let line = try String(
      data: JSONEncoder().encode(event), encoding: .utf8)!
    try emit("agent.event", agentId: agentId, payload: #"{"agent_id":"\#(agentId)","event":\#(line)}"#)
  }

  func emitState(_ state: Transport.State) { continuation.yield(.state(state)) }

  // MARK: HostBackend

  func events() async -> AsyncStream<HostEvent> { stream }

  func request<Params: Encodable & Sendable, Result: Decodable & Sendable>(
    _ method: RemoteMethod, _ params: Params, as: Result.Type
  ) async throws -> Result {
    try answer(method.rawValue, params, as: Result.self)
  }

  func request<C: RemoteCommand>(_ command: C.Type, _ params: C.Params) async throws -> C.Result {
    try answer(C.name, params, as: C.Result.self)
  }

  private func answer<Result: Decodable>(
    _ name: String, _ params: some Encodable, as _: Result.Type
  ) throws -> Result {
    let encoded = (try? JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(params))) ?? .null
    let (json, fails) = lock.withLock { () -> (String?, Bool) in
      log.append(Call(name: name, params: encoded))
      return (dynamic[name]?() ?? replies[name], failing.contains(name))
    }
    if fails { throw Failure() }
    return try ProtocolCodec.decoder.decode(Result.self, from: Data((json ?? "{}").utf8))
  }

  func subscribe(agentId: String, on: Bool) async {
    lock.withLock { subs.append((agentId, on)) }
  }

  func disconnect() async { continuation.finish() }
}
