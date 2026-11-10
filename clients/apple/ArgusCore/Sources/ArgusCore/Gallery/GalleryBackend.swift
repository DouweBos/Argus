import ArgusKit
import Foundation

/// A `HostBackend` answering from wire-format JSON fixtures keyed by method or
/// command name, for the Mac and iOS galleries. `name?param=value` answers just
/// the requests with that string param (`sessions.list?repo_root=/…`), ahead of `name`. Anything unanswered fails and is
/// remembered, so a story's missing data shows up in the gallery's manifest
/// instead of as a blank screen.
public final class GalleryBackend: HostBackend, @unchecked Sendable {
  struct Unanswered: Error, CustomStringConvertible {
    let name: String
    var description: String { "gallery: no fixture for \(name)" }
  }

  public let kind = HostBackendKind.local
  private let replies: [String: String]
  private let lock = NSLock()
  private var misses: Set<String> = []
  private let stream: AsyncStream<HostEvent>

  public init(_ replies: [String: String]) {
    self.replies = replies
    stream = AsyncStream { _ in }
  }

  /// Asked by every store on attach, whatever the story shows.
  private static let ambient: Set<String> = ["state_hydrate"]

  public var unanswered: [String] { lock.withLock { misses.subtracting(Self.ambient).sorted() } }

  public func events() async -> AsyncStream<HostEvent> { stream }

  public func request<Params: Encodable & Sendable, Result: Decodable & Sendable>(
    _ method: RemoteMethod, _ params: Params, as: Result.Type
  ) async throws -> Result {
    try answer(method.rawValue, params, as: Result.self)
  }

  public func request<C: RemoteCommand>(_ command: C.Type, _ params: C.Params) async throws -> C.Result {
    try answer(C.name, params, as: C.Result.self)
  }

  public func subscribe(agentId: String, on: Bool) async {}
  public func disconnect() async {}

  private func answer<Result: Decodable>(_ name: String, _ params: some Encodable, as: Result.Type) throws -> Result {
    let fields = (try? ProtocolCodec.encoder.encode(params))
      .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
    let keyed = fields.sorted { $0.key < $1.key }.compactMap { key, value in
      (value as? String).flatMap { replies["\(name)?\(key)=\($0)"] }
    }
    guard let json = keyed.first ?? replies[name] else {
      _ = lock.withLock { misses.insert(name) }
      throw Unanswered(name: name)
    }
    return try ProtocolCodec.decoder.decode(Result.self, from: Data(json.utf8))
  }
}

/// Fixture JSON from plain dictionaries, in wire (snake_case) keys, shared by
/// both galleries so a story renders the same data on the Mac and the phone.
public enum GalleryJSON {
  public static func encode(_ value: Any) -> String {
    let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    return data.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
  }

  public static func projects(_ names: [String]) -> String {
    encode(["projects": names.map { ["repo_root": "/Users/dev/Projects/\($0)", "name": $0] }])
  }

  public static let someProjects = [
    "react-native-client", "Argus", "Maestro", "luma", "conductor", "houwert.dev",
    "vizbee-chromecast-receiver", "apple-client", "Grove", "Charon", "web-tv-client", "iOS-App",
  ]
}

/// Fixture sets both galleries render, so a Mac story and its iOS twin show the same data.
public enum GalleryFixtures {
  public static var models: [[String: Any]] { [
    [
      "value": "default", "displayName": "Claude Opus 5.5", "description": "Most capable for complex work",
      "supportsEffort": true, "supportedEffortLevels": ["low", "medium", "high", "xhigh", "max"],
    ],
    ["value": "sonnet", "displayName": "Claude Sonnet 5.5", "description": "Best for everyday tasks"],
    ["value": "haiku", "displayName": "Claude Haiku 5.5", "description": "Fastest for quick answers"],
  ] }

  /// What a composer reads: projects, an agent's models and the runners.
  public static var composer: [String: String] {
    [
      RemoteMethod.projectsList.rawValue: GalleryJSON.projects(["Argus", "react-native-client", "conductor"]),
      RemoteMethod.agentsCapabilities.rawValue: GalleryJSON.encode([
        "capabilities": ["models": models, "commands": [], "agents": []]
      ]),
      RemoteMethod.automationsRunners.rawValue: GalleryJSON.encode([
        "runners": [
          [
            "id": "claude-code", "display_name": "Claude Code", "is_custom": false, "models": [],
            "reported_models": models,
          ],
          ["id": "codex", "display_name": "Codex", "is_custom": false, "models": []],
        ]
      ]),
    ]
  }
}
