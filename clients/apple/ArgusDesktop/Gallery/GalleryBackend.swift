#if DEBUG
  import ArgusCore
  import Foundation

  /// A `HostBackend` answering from wire-format JSON fixtures keyed by method or
  /// command name. Anything unanswered fails and is remembered, so a story's
  /// missing data shows up in the gallery's manifest instead of as a blank screen.
  final class GalleryBackend: HostBackend, @unchecked Sendable {
    struct Unanswered: Error, CustomStringConvertible {
      let name: String
      var description: String { "gallery: no fixture for \(name)" }
    }

    let kind = HostBackendKind.local
    private let replies: [String: String]
    private let lock = NSLock()
    private var misses: Set<String> = []
    private let stream: AsyncStream<HostEvent>

    init(_ replies: [String: String]) {
      self.replies = replies
      stream = AsyncStream { _ in }
    }

    /// Asked by every store on attach, whatever the story shows.
    private static let ambient: Set<String> = ["state_hydrate"]

    var unanswered: [String] { lock.withLock { misses.subtracting(Self.ambient).sorted() } }

    func events() async -> AsyncStream<HostEvent> { stream }

    func request<Params: Encodable & Sendable, Result: Decodable & Sendable>(
      _ method: RemoteMethod, _ params: Params, as: Result.Type
    ) async throws -> Result {
      try answer(method.rawValue, as: Result.self)
    }

    func request<C: RemoteCommand>(_ command: C.Type, _ params: C.Params) async throws -> C.Result {
      try answer(C.name, as: C.Result.self)
    }

    func subscribe(agentId: String, on: Bool) async {}
    func disconnect() async {}

    private func answer<Result: Decodable>(_ name: String, as: Result.Type) throws -> Result {
      guard let json = replies[name] else {
        _ = lock.withLock { misses.insert(name) }
        throw Unanswered(name: name)
      }
      return try ProtocolCodec.decoder.decode(Result.self, from: Data(json.utf8))
    }
  }
#endif
