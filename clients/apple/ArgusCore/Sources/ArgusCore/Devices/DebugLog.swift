import Foundation

/// One line of a device log stream (`conductor logs --json`): a structured
/// entry when stdout carried one, else the raw text.
public struct DebugLogEntry: Identifiable, Equatable, Sendable {
  public enum Level: String, Sendable {
    case verbose, debug, log, info, warning, error
  }

  public enum Source: String, Sendable {
    case stdout, stderr
  }

  public var id: Int
  public var level: Level?
  public var message: String
  public var timestamp: String?
  /// `metro`, `device` or `console` for a structured entry.
  public var origin: String?
  public var stackTrace: String?
  public var source: Source
  /// The line as it arrived, for filtering and copying.
  public var raw: String

  /// Warnings and errors, or anything on stderr.
  public var isError: Bool {
    if let level { return level == .error || level == .warning }
    return source == .stderr
  }

  public func matches(_ needle: String) -> Bool {
    let needle = needle.trimmingCharacters(in: .whitespaces).lowercased()
    guard !needle.isEmpty else { return true }
    return "\(message) \(stackTrace ?? "")".lowercased().contains(needle)
  }
}

/// The renderer's `StreamView` parsing: chunks split into lines, JSON entries
/// from stdout recognised, the rest kept as text, the oldest dropped past a cap.
public struct DebugLog: Sendable {
  public private(set) var entries: [DebugLogEntry] = []
  private var nextId = 1
  public let limit: Int

  public init(limit: Int = 2000) {
    self.limit = limit
  }

  public mutating func append(_ chunk: String, source: DebugLogEntry.Source) {
    for line in chunk.split(whereSeparator: \.isNewline) where !line.isEmpty {
      let text = String(line)
      let parsed = source == .stdout ? Self.structured(text) : nil
      entries.append(
        parsed.map { var entry = $0; entry.id = nextId; return entry }
          ?? DebugLogEntry(
            id: nextId, level: nil, message: text, timestamp: nil, origin: nil, stackTrace: nil,
            source: source, raw: text))
      nextId += 1
    }
    if entries.count > limit { entries.removeFirst(entries.count - limit) }
  }

  public mutating func clear() {
    entries = []
  }

  private static let levels: [String: DebugLogEntry.Level] = [
    "verbose": .verbose, "debug": .debug, "log": .log, "info": .info, "warn": .warning,
    "warning": .warning, "error": .error,
  ]

  private struct Line: Decodable {
    var level: String?
    var message: String?
    var source: String?
    var stackTrace: String?
    var status: String?
    var timestamp: String?
  }

  static func structured(_ text: String) -> DebugLogEntry? {
    guard text.hasPrefix("{"),
      let line = try? JSONDecoder().decode(Line.self, from: Data(text.utf8)),
      line.status != "error", let message = line.message, let timestamp = line.timestamp
    else { return nil }
    let origin = ["metro", "device", "console"].contains(line.source ?? "") ? line.source : nil
    return DebugLogEntry(
      id: 0, level: levels[line.level ?? "log"] ?? .log, message: message, timestamp: timestamp,
      origin: origin, stackTrace: line.stackTrace, source: .stdout, raw: text)
  }
}
