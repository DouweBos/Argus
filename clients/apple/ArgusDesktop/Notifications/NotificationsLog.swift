import Foundation
import Observation

/// The warnings and errors list behind `/notifications`, as the desktop app
/// keeps it: in memory, newest first, capped.
@MainActor
@Observable
final class NotificationsLog {
  enum Level: String {
    case error
    case warning
  }

  struct Entry: Identifiable, Equatable {
    let id: UUID
    let level: Level
    let message: String
    let source: String?
    let timestamp: Date
  }

  private(set) var entries: [Entry] = []
  private(set) var lastSeenAt = Date.distantPast
  private static let cap = 200

  var unseenCount: Int { entries.count { $0.timestamp > lastSeenAt } }

  func push(_ level: Level, _ message: String, source: String? = nil) {
    let entry = Entry(id: UUID(), level: level, message: message, source: source, timestamp: .now)
    entries = Array(([entry] + entries).prefix(Self.cap))
  }

  func dismiss(_ id: UUID) {
    entries.removeAll { $0.id == id }
  }

  func clear() {
    entries = []
    lastSeenAt = .now
  }

  func markSeen() {
    lastSeenAt = .now
  }
}
