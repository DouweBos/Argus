import Foundation

/// A commit message as the composer edits it: a one-line summary over an
/// optional description, joined the way git expects.
public struct CommitMessage: Equatable, Sendable {
  public var summary: String
  public var description: String

  public init(summary: String = "", description: String = "") {
    self.summary = summary
    self.description = description
  }

  /// Splits a full message at its first line, as git reads a subject.
  public init(parsing message: String) {
    let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let newline = trimmed.firstIndex(of: "\n") else {
      self.init(summary: trimmed)
      return
    }
    self.init(
      summary: String(trimmed[..<newline]).trimmingCharacters(in: .whitespaces),
      description: String(trimmed[newline...]).trimmingCharacters(in: .whitespacesAndNewlines))
  }

  public var trimmedSummary: String { summary.trimmingCharacters(in: .whitespacesAndNewlines) }

  public var hasDescription: Bool {
    !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  /// The message git gets: summary, a blank line, then the description.
  public var text: String {
    let body = description.trimmingCharacters(in: .whitespacesAndNewlines)
    return body.isEmpty ? trimmedSummary : "\(trimmedSummary)\n\n\(body)"
  }

  public var isEmpty: Bool { trimmedSummary.isEmpty }
}
