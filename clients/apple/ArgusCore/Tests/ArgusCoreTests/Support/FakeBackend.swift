import ArgusCore
import Foundation

/// A scripted `HostBackend`: canned JSON replies by method, events pushed in
/// by the test, and every call recorded.
final class FakeBackend: HostBackend, @unchecked Sendable {
  struct Failure: Error {}

  private let lock = NSLock()
  private var replies: [String: String] = [:]
  private var failing: Set<String> = []
  private var errors: [String: Error] = [:]
  private var calls: [String] = []
  private var subscriptions: [(String, Bool)] = []
  private var held: Set<String> = []
  private var waiters: [String: [CheckedContinuation<Void, Never>]] = [:]
  private let stream: AsyncStream<HostEvent>
  private let continuation: AsyncStream<HostEvent>.Continuation
  let kind: HostBackendKind

  init(kind: HostBackendKind = .local) {
    self.kind = kind
    (stream, continuation) = AsyncStream<HostEvent>.makeStream()
  }

  /// Park every call to `method` until `release`.
  func hold(_ method: RemoteMethod) {
    lock.withLock { _ = held.insert(method.rawValue) }
  }

  func release(_ method: RemoteMethod) {
    let parked = lock.withLock { () -> [CheckedContinuation<Void, Never>] in
      held.remove(method.rawValue)
      return waiters.removeValue(forKey: method.rawValue) ?? []
    }
    for waiter in parked { waiter.resume() }
  }

  func count(_ method: RemoteMethod) -> Int {
    lock.withLock { calls.filter { $0 == method.rawValue }.count }
  }

  func reply(_ method: RemoteMethod, _ json: String) {
    lock.withLock { replies[method.rawValue] = json }
  }

  /// A catalog command, by its wire name (`proposal_accept`).
  func reply(command name: String, _ json: String) {
    lock.withLock { replies[name] = json }
  }

  func fail(command name: String) {
    lock.withLock { _ = failing.insert(name) }
  }

  func fail(_ method: RemoteMethod) {
    lock.withLock { _ = failing.insert(method.rawValue) }
  }

  /// Fail `method` with a specific error, as a transport would throw it.
  func fail(_ method: RemoteMethod, with error: Error) {
    lock.withLock { errors[method.rawValue] = error }
  }

  var requested: [String] { lock.withLock { calls } }

  func emit(_ event: String, agentId: String? = nil, payload: String) throws {
    let agent = agentId.map { #","agent_id":"\#($0)""# } ?? ""
    let json = #"{"seq":1,"event":"\#(event)"\#(agent),"payload":\#(payload)}"#
    let envelope = try ProtocolCodec.decoder.decode(EventEnvelope.self, from: Data(json.utf8))
    continuation.yield(.event(envelope))
  }

  func emitState(_ state: Transport.State) {
    continuation.yield(.state(state))
  }

  func events() async -> AsyncStream<HostEvent> { stream }

  func request<Params: Encodable & Sendable, Result: Decodable & Sendable>(
    _ method: RemoteMethod, _ params: Params, as: Result.Type
  ) async throws -> Result {
    await waitIfHeld(method.rawValue)
    return try answer(method.rawValue, as: Result.self)
  }

  private func waitIfHeld(_ name: String) async {
    await withCheckedContinuation { continuation in
      let parked = lock.withLock { () -> Bool in
        guard held.contains(name) else { return false }
        waiters[name, default: []].append(continuation)
        return true
      }
      if !parked { continuation.resume() }
    }
  }

  func request<C: RemoteCommand>(_ command: C.Type, _ params: C.Params) async throws -> C.Result {
    try answer(C.name, as: C.Result.self)
  }

  private func answer<Result: Decodable>(_ name: String, as _: Result.Type) throws -> Result {
    let (json, fails, error) = lock.withLock { () -> (String?, Bool, Error?) in
      calls.append(name)
      return (replies[name], failing.contains(name), errors[name])
    }
    if let error { throw error }
    if fails { throw Failure() }
    return try ProtocolCodec.decoder.decode(Result.self, from: Data((json ?? "{}").utf8))
  }

  func subscribe(agentId: String, on: Bool) async {
    lock.withLock { subscriptions.append((agentId, on)) }
  }

  func disconnect() async {
    continuation.finish()
  }
}

/// Poll until `condition` holds; events reach the store on its own task.
@MainActor
func eventually(
  timeout: Duration = .seconds(2), _ condition: @MainActor () -> Bool
) async -> Bool {
  let clock = ContinuousClock()
  let deadline = clock.now.advanced(by: timeout)
  while clock.now < deadline {
    if condition() { return true }
    try? await Task.sleep(for: .milliseconds(10))
  }
  return condition()
}
