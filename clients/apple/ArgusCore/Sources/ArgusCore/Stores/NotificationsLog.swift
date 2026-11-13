import Foundation
import Observation

/// The warnings, errors and housekeeping notes behind Notifications, on the Mac and the
/// phone: in memory, newest first, capped.
@MainActor
@Observable
public final class NotificationsLog {
  public enum Level: String, Sendable {
    case error
    case warning
    /// Something Argus did on its own that you'd want to know about, like a cleanup.
    case info
  }

  public struct Entry: Identifiable, Equatable, Sendable {
    public let id: UUID
    public let level: Level
    public let message: String
    public let source: String?
    /// When it first appeared; a repeat doesn't make it new again.
    public let firstAt: Date
    /// When it last happened.
    public internal(set) var timestamp: Date
    /// How many times in a row it happened.
    public internal(set) var count: Int
  }

  public private(set) var entries: [Entry] = []
  public private(set) var lastSeenAt = Date.distantPast
  public static let cap = 200

  private let now: () -> Date

  public init(now: @escaping () -> Date = Date.init) {
    self.now = now
  }

  /// Repeats only count once, so a polling screen's failure can't keep the badge climbing.
  public var unseenCount: Int { entries.count { $0.firstAt > lastSeenAt } }

  public func push(_ level: Level, _ message: String, source: String? = nil) {
    let at = now()
    // A polling screen repeats its failure every few seconds; keep one entry.
    if var first = entries.first, first.level == level, first.message == message,
      first.source == source
    {
      first.timestamp = at
      first.count += 1
      entries[0] = first
      return
    }
    let entry = Entry(
      id: UUID(), level: level, message: message, source: source, firstAt: at, timestamp: at,
      count: 1)
    entries = Array(([entry] + entries).prefix(Self.cap))
  }

  public func dismiss(_ id: UUID) {
    entries.removeAll { $0.id == id }
  }

  public func clear() {
    entries = []
    lastSeenAt = now()
  }

  public func markSeen() {
    lastSeenAt = now()
  }
}
