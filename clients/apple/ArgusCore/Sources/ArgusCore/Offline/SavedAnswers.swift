import ArgusKit
import CryptoKit
import Foundation
import Synchronization

/// One computer's last answers to the reads worth having offline — lists,
/// transcripts, git state and diffs, pull requests, the inbox — sealed on disk
/// so they are still readable after a restart with no connection.
///
/// Bounded by size, least recently used out first, so it holds what was
/// looked at last rather than everything ever opened.
public final class SavedAnswers: Sendable {
  /// Reads whose answers are kept. Anything that acts is never replayed.
  public static let methods: Set<String> = [
    "projects.list", "sessions.list", "scratch_pads.list", "agents.list", "agents.status",
    "agents.stopped", "agents.transcript", "agents.stopped_transcript", "agents.image",
    "agents.stopped_image", "agents.queue_list", "agents.capabilities", "sessions.git_status",
    "sessions.diff", "github.pull_requests", "github.pull_request",
    ArgusProtocol.Commands.ProposalsList.name, ArgusProtocol.Commands.ProposalGet.name,
    ArgusProtocol.Commands.AutomationRunsList.name, ArgusProtocol.Commands.AutomationRunGet.name,
    ArgusProtocol.Commands.GetSession.name,
  ]

  public static let defaultBudget = 32 * 1024 * 1024
  static let maxEntries = 800

  struct Entry: Codable, Equatable {
    var file: String
    var savedAt: Double
    var usedAt: Double
    var size: Int
    var digest: String
  }

  private struct Index: Codable {
    var entries: [String: Entry] = [:]
    var totalSize: Int { entries.values.reduce(0) { $0 + $1.size } }
  }

  private static let indexName = "index"
  private let files: SealedFiles
  private let budget: Int
  private let index: Mutex<Index>
  private let lastIndexWrite = Mutex<Double>(0)

  public init(files: SealedFiles, budget: Int = SavedAnswers.defaultBudget) {
    self.files = files
    self.budget = budget
    let loaded = files.read(Self.indexName).flatMap { try? JSONDecoder().decode(Index.self, from: $0) }
    // An index that won't open (a lost key) leaves its answers unreadable too.
    if loaded == nil { files.removeAll() }
    index = Mutex(loaded ?? Index())
  }

  /// This phone's saved answers for one computer; nil when the keychain can't seal them.
  public static func forHost(_ hostId: String) -> SavedAnswers? {
    SealedFiles.app("SavedAnswers").map { SavedAnswers(files: $0.folder(hostId)) }
  }

  /// Forget one computer's saved answers, e.g. on unpairing it.
  public static func remove(hostId: String) {
    SealedFiles.app("SavedAnswers")?.folder(hostId).removeAll()
  }

  public static func key(_ method: String, _ params: some Encodable) -> String {
    let json = (try? canonical.encode(params)).map { String(decoding: $0, as: UTF8.self) } ?? ""
    return "\(method) \(json)"
  }

  public func answer(_ key: String, now: Date = Date()) -> (value: JSONValue, savedAt: Date)? {
    guard let entry = index.withLock({ index -> Entry? in
      index.entries[key]?.usedAt = now.timeIntervalSince1970
      return index.entries[key]
    }) else { return nil }
    guard let data = files.read(entry.file), let value = try? JSONDecoder().decode(JSONValue.self, from: data)
    else {
      index.withLock { _ = $0.entries.removeValue(forKey: key) }
      return nil
    }
    return (value, Date(timeIntervalSince1970: entry.savedAt))
  }

  public func save(_ value: JSONValue, key: String, now: Date = Date()) {
    guard let data = try? Self.canonical.encode(value) else { return }
    let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    let stamp = now.timeIntervalSince1970
    let file = Self.fileName(key)
    // Unchanged content only moves its timestamps; the file stays as it is.
    let unchanged = index.withLock { index -> Index? in
      guard index.entries[key]?.digest == digest else { return nil }
      index.entries[key]?.savedAt = stamp
      index.entries[key]?.usedAt = stamp
      return index
    }
    if let unchanged {
      // Throttled: a poll re-confirms the same answer every few seconds.
      let due = lastIndexWrite.withLock { last -> Bool in
        guard stamp - last >= 30 else { return false }
        last = stamp
        return true
      }
      if due { writeIndex(unchanged) }
      return
    }
    guard files.write(data, to: file) else { return }

    let (evicted, snapshot) = index.withLock { index -> ([String], Index) in
      index.entries[key] = Entry(file: file, savedAt: stamp, usedAt: stamp, size: data.count, digest: digest)
      var evicted: [String] = []
      var total = index.totalSize
      let oldest = index.entries.filter { $0.key != key }.sorted { $0.value.usedAt < $1.value.usedAt }
      for (old, entry) in oldest where total > budget || index.entries.count > Self.maxEntries {
        index.entries[old] = nil
        total -= entry.size
        evicted.append(entry.file)
      }
      return (evicted, index)
    }
    for file in evicted { files.remove(file) }
    lastIndexWrite.withLock { $0 = stamp }
    writeIndex(snapshot)
  }

  private func writeIndex(_ snapshot: Index) {
    if let data = try? JSONEncoder().encode(snapshot) { files.write(data, to: Self.indexName) }
  }

  public func clear() {
    index.withLock { $0 = Index() }
    files.removeAll()
  }

  var entryCount: Int { index.withLock { $0.entries.count } }

  private static let canonical: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return encoder
  }()

  private static func fileName(_ key: String) -> String {
    SHA256.hash(data: Data(key.utf8)).prefix(16).map { String(format: "%02x", $0) }.joined()
  }
}
