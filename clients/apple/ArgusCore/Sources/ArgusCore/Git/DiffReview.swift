import Foundation
import Observation

/// A draft comment on a diff line or run of lines, waiting to go to the agent as part of a review.
public struct DiffReviewComment: Identifiable, Hashable, Sendable {
  /// Which side of the diff the line numbers count: removed lines only exist on the old one.
  public enum Side: String, Hashable, Sendable {
    case old
    case new
  }

  public let id: UUID
  public var path: String
  public var side: Side
  public var lines: ClosedRange<Int>
  /// The commented lines' text, so the comment finds its lines again after the diff moves.
  public var excerpt: [String]
  /// The hunk as unified diff text, header first.
  public var hunk: String
  /// What the diff compared: "uncommitted changes", "staged changes", "main...feature".
  public var scope: String
  public var body: String

  public init(
    id: UUID = UUID(), path: String, side: Side, lines: ClosedRange<Int>, excerpt: [String], hunk: String,
    scope: String, body: String
  ) {
    self.id = id
    self.path = path
    self.side = side
    self.lines = lines
    self.excerpt = excerpt
    self.hunk = hunk
    self.scope = scope
    self.body = body
  }

  /// `src/app.ts:12` or `src/app.ts:12-18`, with `(removed)` for old-side lines.
  public var location: String {
    let range = lines.count == 1 ? "\(lines.lowerBound)" : "\(lines.lowerBound)-\(lines.upperBound)"
    return "\(path):\(range)" + (side == .old ? " (removed)" : "")
  }

  /// Whether this comment belongs on these lines of `path`, as a diff now shows them.
  public func anchors(path: String, side: Side, last line: Int, text: String) -> Bool {
    self.path == path && self.side == side && lines.upperBound == line && excerpt.last == text
  }
}

/// Draft review comments per session. In memory only: a review is a few minutes' work, sent or dropped.
@MainActor
@Observable
public final class DiffReviewDrafts {
  public private(set) var bySession: [String: [DiffReviewComment]] = [:]

  public init() {}

  public func comments(_ sessionId: String) -> [DiffReviewComment] { bySession[sessionId] ?? [] }

  public func comments(_ sessionId: String, path: String) -> [DiffReviewComment] {
    comments(sessionId).filter { $0.path == path }
  }

  public func add(_ comment: DiffReviewComment, sessionId: String) {
    bySession[sessionId, default: []].append(comment)
  }

  public func update(_ id: UUID, body: String, sessionId: String) {
    guard let index = bySession[sessionId]?.firstIndex(where: { $0.id == id }) else { return }
    bySession[sessionId]?[index].body = body
  }

  public func remove(_ id: UUID, sessionId: String) {
    bySession[sessionId]?.removeAll { $0.id == id }
    if bySession[sessionId]?.isEmpty == true { bySession[sessionId] = nil }
  }

  public func clear(_ sessionId: String) { bySession[sessionId] = nil }
}

/// The text a review becomes: one message for the agent, and the shorter one the transcript shows.
public enum DiffReviewPrompt {
  public static func message(_ comments: [DiffReviewComment]) -> String {
    var out = "Please address my review comments on the diff. Each one quotes the hunk it is about.\n"
    for (index, comment) in sorted(comments).enumerated() {
      let fence = String(repeating: "`", count: max(3, longestBacktickRun(in: comment.hunk) + 1))
      out += "\n## \(index + 1). \(comment.location)\n"
      out += "In the \(comment.scope):\n\(fence)diff\n\(comment.hunk)\n\(fence)\n\n\(comment.body)\n"
    }
    return out
  }

  /// One line per comment, without the hunks.
  public static func displayText(_ comments: [DiffReviewComment]) -> String {
    let files = Set(comments.map(\.path)).count
    let head = "Review: \(plural(comments.count, "comment")) on \(plural(files, "file"))"
    return ([head] + sorted(comments).map { "- \($0.location): \($0.body)" }).joined(separator: "\n")
  }

  /// What a fresh agent is asked to review before a commit.
  public static func reviewRequest(baseBranch: String?) -> (message: String, displayText: String) {
    let scope =
      baseBranch.map { "everything on this branch since it left `\($0)` (`git diff \($0)...HEAD`) plus any uncommitted changes (`git diff HEAD`)" }
      ?? "the uncommitted changes (`git diff HEAD`, and `git status` for new files)"
    let message = """
      Review the code before I commit it: \(scope).
      Look for bugs, edge cases, security problems, missing tests and code that doesn't match the codebase's conventions. \
      For each finding give the file and line, what's wrong and how to fix it, most severe first. \
      Don't edit any files; report only. Say so plainly if you find nothing worth changing.
      """
    return (message, "Review the code before I commit it")
  }

  public static func plural(_ count: Int, _ noun: String) -> String {
    "\(count) \(noun)\(count == 1 ? "" : "s")"
  }

  private static func sorted(_ comments: [DiffReviewComment]) -> [DiffReviewComment] {
    comments.sorted { ($0.path, $0.lines.lowerBound) < ($1.path, $1.lines.lowerBound) }
  }

  private static func longestBacktickRun(in text: String) -> Int {
    var longest = 0
    var run = 0
    for character in text {
      run = character == "`" ? run + 1 : 0
      longest = max(longest, run)
    }
    return longest
  }
}

extension DiffReviewComment {
  /// A draft on one line of a parsed diff (the phone's diff, a line per tap); nil for a "no newline" marker.
  public static func draft(path: String, hunk: DiffHunk, line: DiffLine, scope: String) -> DiffReviewComment? {
    let side: Side = line.kind == .remove ? .old : .new
    guard line.kind != .noNewline, let number = side == .old ? line.oldNumber : line.newNumber else { return nil }
    let text = ([hunk.header] + hunk.lines.map { line in
      switch line.kind {
      case .add: "+" + line.text
      case .remove: "-" + line.text
      case .context: " " + line.text
      case .noNewline: "\\" + line.text
      }
    }).joined(separator: "\n")
    return DiffReviewComment(
      path: path, side: side, lines: number...number, excerpt: [line.text], hunk: text, scope: scope, body: "")
  }

  /// Whether this comment hangs under `line` of a parsed diff of `path`.
  public func anchors(path: String, line: DiffLine) -> Bool {
    let side: Side = line.kind == .remove ? .old : .new
    guard let number = side == .old ? line.oldNumber : line.newNumber else { return false }
    return anchors(path: path, side: side, last: number, text: line.text)
  }
}
