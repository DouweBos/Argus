import Foundation

/// Find-in-chat over what the transcript renders. Matches the desktop's rules:
/// trimmed query, case-insensitive, non-overlapping, wrapping navigation.
public enum TranscriptSearch {
  /// One searchable piece of the transcript — a message's text, or a tool
  /// call's summary line — under an id the view can highlight and scroll to.
  public struct Unit: Sendable {
    public var id: String
    public var text: String

    public init(id: String, text: String) {
      self.id = id
      self.text = text
    }
  }

  public struct Hit: Hashable, Sendable {
    public var unitId: String
    /// UTF-16, as a text view highlights it.
    public var range: NSRange

    public init(unitId: String, range: NSRange) {
      self.unitId = unitId
      self.range = range
    }
  }

  public static func find(_ query: String, in units: [Unit]) -> [Hit] {
    let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !needle.isEmpty else { return [] }
    var hits: [Hit] = []
    for unit in units {
      let text = unit.text as NSString
      var from = 0
      while from < text.length {
        let found = text.range(
          of: needle, options: [.caseInsensitive],
          range: NSRange(location: from, length: text.length - from))
        guard found.location != NSNotFound, found.length > 0 else { break }
        hits.append(Hit(unitId: unit.id, range: found))
        from = NSMaxRange(found)
      }
    }
    return hits
  }

  /// The next (or previous) hit from `current`, wrapping at either end.
  public static func step(from current: Int?, count: Int, forward: Bool) -> Int? {
    guard count > 0 else { return nil }
    guard let current else { return forward ? 0 : count - 1 }
    return (current + (forward ? 1 : -1) + count) % count
  }

  /// "3 of 12", "No matches", or nothing while the query is empty.
  public static func counter(query: String, count: Int, current: Int?) -> String {
    if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "" }
    guard count > 0 else { return "No matches" }
    return "\((current ?? 0) + 1) of \(count)"
  }
}
