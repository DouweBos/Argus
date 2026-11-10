import ArgusKit
import Foundation

/// Replies written while the computer was out of reach, sealed on disk until
/// the next connection sends them.
///
/// Bounded like the offline permission answers: a reply a day old is more
/// likely to confuse an agent that moved on than to help it.
public struct Outbox: Sendable {
  public static let maxAge: TimeInterval = 24 * 60 * 60
  public static let maxQueued = 20

  public struct Entry: Codable, Equatable, Sendable {
    public var agentId: String
    public var message: FailedSend
    public var at: Date
  }

  private static let fileName = "replies"
  private let files: SealedFiles

  public init(files: SealedFiles) {
    self.files = files
  }

  public static func forHost(_ hostId: String) -> Outbox? {
    SealedFiles.app("Outbox").map { Outbox(files: $0.folder(hostId)) }
  }

  public static func remove(hostId: String) {
    SealedFiles.app("Outbox")?.folder(hostId).removeAll()
  }

  public func load(now: Date = Date()) -> [Entry] {
    guard let data = files.read(Self.fileName),
      let entries = try? JSONDecoder().decode([Entry].self, from: data)
    else { return [] }
    return entries.filter { now.timeIntervalSince($0.at) <= Self.maxAge }
  }

  public func save(_ entries: [Entry]) {
    guard !entries.isEmpty else { return files.remove(Self.fileName) }
    guard let data = try? JSONEncoder().encode(Array(entries.suffix(Self.maxQueued))) else { return }
    files.write(data, to: Self.fileName)
  }
}
