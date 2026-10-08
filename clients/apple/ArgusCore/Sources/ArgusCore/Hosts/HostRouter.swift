import ArgusKit
import Foundation
import Synchronization

/// The Mac app's backend when it drives more than its own host: the local
/// socket plus any number of paired hosts, behind the one `HostBackend` the
/// stores already talk to — the counterpart of the desktop's
/// `app/lib/transport/`.
///
/// Every call goes to the host that owns its subject (`HostIndex`), in the
/// desktop's order: an explicit pin (`HostRouter.$pinned`), then the subject,
/// then the focused host, then this Mac. Lists that span machines — projects,
/// scratch pads, the agent list, the hydrate snapshot — are asked of every
/// attached host and merged; an offline host contributes its last answer, so
/// its projects stay on screen read-only. Events from every host arrive on one
/// stream; only this Mac's connection state reaches the store, since one
/// host dropping mustn't take the window offline.
public final class HostRouter: HostBackend {
  /// Pins every call made inside to one host — the runtime panel of a remote
  /// session, a remote git runner. Inherited by child tasks.
  @TaskLocal public static var pinned: HostId?

  public let kind = HostBackendKind.local
  public let local: LocalBackend
  public let index: HostIndex

  private struct State {
    var links: [HostId: RemoteHostLink] = [:]
    var labels: [HostId: String] = [:]
    var focused: HostId = Hosts.local
    var continuation: AsyncStream<HostEvent>.Continuation?
    /// Each host's last answer to a merged list, served while it is offline.
    var cache: [String: JSONValue] = [:]
    /// `host:remoteStreamId` → the stream id the store sees.
    var streams: [String: UInt16] = [:]
    var nextStream: UInt16 = Self.remoteStreamBase
    static let remoteStreamBase: UInt16 = 0x8000
  }

  private let state = Mutex(State())
  private let onRemote: @Sendable (HostId, RemoteHostLink.Event) -> Void
  private let snapshots: HostSnapshotFiles?

  /// Lists asked of every host and merged, when nothing narrows them to one.
  static let mergedMethods: Set<String> = [
    "projects.list", "scratch_pads.list", "agents.list", "state_hydrate",
  ]

  /// A paired host's lists, kept (and saved) so an offline host still shows
  /// what it last said.
  static let snapshotMethods: Set<String> = mergedMethods.union(["sessions.list", "agents.stopped"])

  /// `onRemote` sees each paired host's connection changes (and its events),
  /// for the app's own bookkeeping.
  /// `snapshots` keeps each host's last lists on disk across launches.
  public init(
    local: LocalBackend, index: HostIndex = HostIndex(), snapshots: HostSnapshotFiles? = nil,
    onRemote: @escaping @Sendable (HostId, RemoteHostLink.Event) -> Void = { _, _ in }
  ) {
    self.local = local
    self.index = index
    self.onRemote = onRemote
    self.snapshots = snapshots
    guard let snapshots else { return }
    for (hostId, answers) in snapshots.loadAll() {
      state.withLock { state in
        for (key, value) in answers { state.cache["\(hostId)\(key)"] = value }
      }
      for (key, value) in answers {
        let method = key.split(separator: "|", omittingEmptySubsequences: false).dropFirst().first
        index.learn(response: value, method: method.map(String.init) ?? "", host: hostId)
      }
    }
  }

  /// Keep a host's answer, on disk too when it changed.
  private func remember(_ result: JSONValue, key: String, host hostId: HostId) {
    let changed = state.withLock { state -> [String: JSONValue]? in
      let full = hostId + key
      guard state.cache[full] != result else { return nil }
      state.cache[full] = result
      return state.cache.filter { $0.key.hasPrefix("\(hostId)|") }
        .reduce(into: [:]) { $0[String($1.key.dropFirst(hostId.count))] = $1.value }
    }
    if let changed { snapshots?.save(changed, for: hostId) }
  }

  private func cacheKey(_ method: String, _ params: JSONValue) -> String {
    "|\(method)|\((try? ProtocolCodec.encoder.encode(params)).map { String(decoding: $0, as: UTF8.self) } ?? "")"
  }

  // MARK: Hosts

  /// Start routing to a connected host.
  public func add(_ link: RemoteHostLink, label: String) async {
    let previous = state.withLock { state -> RemoteHostLink? in
      let previous = state.links[link.hostId]
      state.links[link.hostId] = link
      state.labels[link.hostId] = label
      return previous
    }
    await previous?.disconnect()
    let hostId = link.hostId
    await link.start { [weak self] event in self?.remote(hostId, event) }
  }

  /// Stop routing to a host. Its ids stay in the index, so a call about one of
  /// its sessions still resolves to it and fails, rather than landing here.
  public func remove(_ hostId: HostId) async {
    let link = state.withLock { $0.links.removeValue(forKey: hostId) }
    await link?.disconnect()
  }

  /// Unpaired: forget its ids and cached lists too.
  public func forget(_ hostId: HostId) async {
    await remove(hostId)
    index.forget(host: hostId)
    state.withLock { state in
      state.cache = state.cache.filter { !$0.key.hasPrefix("\(hostId)|") }
      state.labels[hostId] = nil
      if state.focused == hostId { state.focused = Hosts.local }
    }
    snapshots?.remove(hostId)
  }

  /// Detached: its lists leave the merged answers.
  public func dropCache(_ hostId: HostId) {
    state.withLock { state in
      state.cache = state.cache.filter { !$0.key.hasPrefix("\(hostId)|") }
    }
    snapshots?.remove(hostId)
  }

  public func setLabel(_ label: String, for hostId: HostId) {
    state.withLock { $0.labels[hostId] = label }
  }

  /// The host calls that name nothing go to.
  public var focusedHost: HostId {
    get { state.withLock { $0.focused } }
    set { state.withLock { $0.focused = newValue } }
  }

  public func link(_ hostId: HostId) -> RemoteHostLink? {
    state.withLock { $0.links[hostId] }
  }

  /// Which machine owns a session, project or agent; this Mac when unknown.
  public func host(of kind: HostIndex.Kind, _ id: String) -> HostId {
    if kind == .project, let (owner, _) = HostScopedPath.split(id) { return owner }
    return index.host(of: kind, id) ?? Hosts.local
  }

  // MARK: Events

  public func events() async -> AsyncStream<HostEvent> {
    let (stream, continuation) = AsyncStream<HostEvent>.makeStream()
    state.withLock { $0.continuation = continuation }
    let upstream = await local.events()
    let index = index
    let pump = Task {
      for await event in upstream {
        if case .event(let envelope) = event { index.learn(event: envelope, host: Hosts.local) }
        continuation.yield(event)
      }
    }
    continuation.onTermination = { _ in pump.cancel() }
    return stream
  }

  private func remote(_ hostId: HostId, _ event: RemoteHostLink.Event) {
    let continuation = state.withLock { $0.continuation }
    switch event {
    case .state:
      // The window's connection is this Mac's; a host's is its own business.
      break
    case .event(var envelope):
      envelope.payload = HostScopedPath.scopeRoots(in: envelope.payload, host: hostId)
      index.learn(event: envelope, host: hostId)
      continuation?.yield(.event(envelope))
    case .media(let bytes):
      if let mapped = remap(media: bytes, from: hostId) { continuation?.yield(.media(mapped)) }
    }
    onRemote(hostId, event)
  }

  /// Stream ids are per host; a remote one is renumbered into the upper half
  /// so it can't collide with this Mac's or another host's.
  private func remap(media bytes: Data, from hostId: HostId) -> Data? {
    guard bytes.count >= 4 else { return nil }
    let start = bytes.startIndex
    let remoteId = UInt16(bytes[start + 2]) | (UInt16(bytes[start + 3]) << 8)
    guard let global = state.withLock({ $0.streams["\(hostId):\(remoteId)"] }) else { return nil }
    var copy = Data(bytes)
    copy[2] = UInt8(global & 0xFF)
    copy[3] = UInt8(global >> 8)
    return copy
  }

  private func globalStream(_ remoteId: Int, on hostId: HostId) -> Int {
    state.withLock { state in
      let key = "\(hostId):\(remoteId)"
      if let existing = state.streams[key] { return Int(existing) }
      let id = state.nextStream
      state.nextStream = id == .max ? State.remoteStreamBase : id + 1
      state.streams = state.streams.filter { $0.value != id }
      state.streams[key] = id
      return Int(id)
    }
  }

  // MARK: Routing

  enum Destination: Equatable {
    case local
    case remote(HostId)
    case merged
  }

  /// Where a call goes, before checking whether that host can take it.
  func destination(
    _ method: String, _ params: JSONValue, tier: String?, scopedHost: HostId? = nil
  ) -> Destination {
    if let pinned = Self.pinned {
      return pinned == Hosts.local ? .local : .remote(pinned)
    }
    if HostCommandTarget.of(method, tier: tier) == .client { return .local }
    if let scopedHost { return .remote(scopedHost) }
    if let owner = index.subject(of: params) {
      return owner == Hosts.local ? .local : .remote(owner)
    }
    // An id nobody has claimed is this Mac's until a host says otherwise —
    // the focused host would get a local session's calls at launch.
    if index.unknownSubject(of: params) != nil { return .local }
    if Self.mergedMethods.contains(method) { return .merged }
    let focused = focusedHost
    return focused == Hosts.local ? .local : .remote(focused)
  }

  /// How long a call naming an unclaimed id waits for its host to mention it.
  static let indexWait: Duration = .seconds(2)

  /// With other hosts attached, an id this index hasn't seen may be theirs and
  /// in flight (a just-created agent, a list still loading); wait for it.
  private func awaitIndexed(_ known: @Sendable () -> Bool) async {
    guard state.withLock({ !$0.links.isEmpty }) else { return }
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: Self.indexWait)
    while !known(), clock.now < deadline {
      try? await Task.sleep(for: .milliseconds(50))
    }
  }

  private func unavailable(_ hostId: HostId, _ message: String) -> Error {
    Transport.TransportError.gateway(GatewayErrorPayload(code: "unavailable", message: message))
  }

  private func label(_ hostId: HostId) -> String {
    state.withLock { $0.labels[hostId] } ?? "That host"
  }

  /// The link to send to, or why not: offline, or a command that only makes
  /// sense on the machine holding the files.
  private func readyLink(_ hostId: HostId, method: String, tier: String?) throws -> RemoteHostLink {
    if HostCommandTarget.of(method, tier: tier) == .unavailable {
      throw unavailable(
        hostId,
        "This acts on the machine holding the files, so it isn't available for \(label(hostId)).")
    }
    guard let link = link(hostId), link.isReady else {
      throw unavailable(hostId, "\(label(hostId)) is not connected right now.")
    }
    return link
  }

  func dispatch(
    _ method: String, _ params: JSONValue, tier: String?, timeout: Duration? = nil
  ) async throws -> (result: JSONValue, seq: Int, host: HostId) {
    let scoped = params
    let (params, scopedHost) = HostScopedPath.unscope(scoped)
    if Self.pinned == nil, scopedHost == nil, index.unknownSubject(of: params) != nil {
      await awaitIndexed { self.index.unknownSubject(of: params) == nil }
    }
    switch destination(method, params, tier: tier, scopedHost: scopedHost) {
    case .local:
      let (result, seq) = try await local.transport.sequencedRequest(
        method: method, params, as: JSONValue.self)
      index.learn(response: result, method: method, host: Hosts.local)
      return (result, seq, Hosts.local)
    case .remote(let hostId):
      let snapshots = Self.snapshotMethods.contains(method)
      let key = cacheKey(method, scoped)
      let link: RemoteHostLink
      do {
        link = try readyLink(hostId, method: method, tier: tier)
      } catch {
        if snapshots, let cached = state.withLock({ $0.cache[hostId + key] }) {
          return (cached, Int.min, hostId)
        }
        throw error
      }
      var (result, seq): (JSONValue, Int)
      if let timeout {
        (result, seq) = (try await link.request(method, params, timeout: timeout), Int.min)
      } else {
        (result, seq) = try await link.sequencedRequest(method, params)
      }
      if !HostIndex.skipsLearning(method) {
        result = HostScopedPath.scopeRoots(in: result, host: hostId)
      }
      index.learn(response: result, method: method, host: hostId)
      if snapshots { remember(result, key: key, host: hostId) }
      result = renumberStream(in: result, from: hostId)
      return (result, seq, hostId)
    case .merged:
      return (try await merged(method, params, tier: tier), Int.min, Hosts.local)
    }
  }

  private func renumberStream(in result: JSONValue, from hostId: HostId) -> JSONValue {
    guard case .object(var object) = result, case .number(let id) = object["stream_id"] else {
      return result
    }
    object["stream_id"] = .number(Double(globalStream(Int(id), on: hostId)))
    return .object(object)
  }

  /// Ask every host, this Mac first; an offline one answers from its cache.
  private func merged(_ method: String, _ params: JSONValue, tier: String?) async throws -> JSONValue {
    let localResult = try await local.request(method: method, params, as: JSONValue.self)
    index.learn(response: localResult, method: method, host: Hosts.local)
    let cacheKey = cacheKey(method, params)
    let links = state.withLock { state in state.links }
    let cachedKeys = state.withLock { state in Set(state.cache.keys) }
    let remoteHosts = Set(links.keys).union(
      cachedKeys.filter { $0.hasSuffix(cacheKey) }.map { String($0.prefix { $0 != "|" }) })
    var results: [JSONValue] = [localResult]
    await withTaskGroup(of: JSONValue?.self) { group in
      for hostId in remoteHosts.sorted() {
        let link = links[hostId]
        group.addTask { [self] in
          let key = hostId + cacheKey
          if let link, link.isReady, HostCommandTarget.of(method, tier: tier) == .host,
            let raw = try? await link.request(method, params)
          {
            let result = HostScopedPath.scopeRoots(in: raw, host: hostId)
            index.learn(response: result, method: method, host: hostId)
            remember(result, key: cacheKey, host: hostId)
            return result
          }
          return state.withLock { $0.cache[key] }
        }
      }
      for await result in group { if let result { results.append(result) } }
    }
    return results.dropFirst().reduce(localResult, Self.merge)
  }

  /// Lists concatenate; objects merge key by key; anything else keeps the first.
  static func merge(_ a: JSONValue, _ b: JSONValue) -> JSONValue {
    switch (a, b) {
    case (.array(let x), .array(let y)): return .array(x + y)
    case (.object(var x), .object(let y)):
      for (key, value) in y { x[key] = x[key].map { merge($0, value) } ?? value }
      return .object(x)
    case (.null, _): return b
    default: return a
    }
  }

  // MARK: HostBackend

  public func request<Params: Encodable & Sendable, Result: Decodable & Sendable>(
    _ method: RemoteMethod, _ params: Params, as: Result.Type
  ) async throws -> Result {
    let json = try ProtocolCodec.convert(params)
    let (result, _, _) = try await dispatch(method.rawValue, json, tier: nil)
    return try ProtocolCodec.convert(result, to: Result.self)
  }

  public func sequencedRequest<Params: Encodable & Sendable, Result: Decodable & Sendable>(
    _ method: RemoteMethod, _ params: Params, as: Result.Type
  ) async throws -> (result: Result, seq: Int) {
    let json = try ProtocolCodec.convert(params)
    let (result, seq, _) = try await dispatch(method.rawValue, json, tier: nil)
    return (try ProtocolCodec.convert(result, to: Result.self), seq)
  }

  public func request<C: RemoteCommand>(_ command: C.Type, _ params: C.Params) async throws
    -> C.Result
  {
    let json = try ProtocolCodec.convert(params)
    let (result, _, _) = try await dispatch(C.name, json, tier: C.tier)
    return try ProtocolCodec.convert(result, to: C.Result.self)
  }

  public func sequencedRequest<C: RemoteCommand>(_ command: C.Type, _ params: C.Params)
    async throws -> (result: C.Result, seq: Int)
  {
    let json = try ProtocolCodec.convert(params)
    let (result, seq, _) = try await dispatch(C.name, json, tier: C.tier)
    return (try ProtocolCodec.convert(result, to: C.Result.self), seq)
  }

  /// A command by name, with its own timeout — a remote git fetch outlives the
  /// default.
  public func request<Params: Encodable & Sendable, Result: Decodable & Sendable>(
    method: String, _ params: Params, as: Result.Type, tier: String? = nil,
    timeout: Duration? = nil
  ) async throws -> Result {
    let json = try ProtocolCodec.convert(params)
    let (result, _, _) = try await dispatch(method, json, tier: tier, timeout: timeout)
    return try ProtocolCodec.convert(result, to: Result.self)
  }

  /// Agent scopes go to the agent's host, `terminal:<id>` to the terminal's;
  /// anything pinned to the host it was pinned to.
  public func subscribe(agentId scope: String, on: Bool) async {
    if Self.pinned == nil, index.unknownScope(scope) {
      await awaitIndexed { !self.index.unknownScope(scope) }
    }
    let hostId = Self.pinned ?? index.subscriptionHost(scope) ?? Hosts.local
    if hostId == Hosts.local {
      await local.subscribe(agentId: scope, on: on)
    } else {
      await link(hostId)?.subscribe(scope, on: on)
    }
  }

  public func disconnect() async {
    let links = state.withLock { state in
      let links = Array(state.links.values)
      state.links = [:]
      return links
    }
    for link in links { await link.disconnect() }
    await local.disconnect()
  }
}

extension ProtocolCodec {
  /// Any encodable value as dynamic JSON, for inspecting a call's params.
  public static func convert<T: Encodable>(_ value: T) throws -> JSONValue {
    try decoder.decode(JSONValue.self, from: try encoder.encode(value))
  }
}
