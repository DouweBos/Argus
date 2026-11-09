import ArgusCore
import Foundation
import GroveKit

/// What a diff needs to take review comments: the drafts on its file and where new ones go.
struct DiffReviewContext {
  /// What the diff compares, as the prompt names it: "uncommitted changes", "main...feature".
  let scope: String
  let comments: [DiffReviewComment]
  let add: (DiffReviewComment) -> Void
  let update: (UUID, String) -> Void
  let delete: (UUID) -> Void
}

/// Turns picked diff lines into a comment, and finds where a comment sits in a diff.
@MainActor
enum DiffReviewAnchors {
  /// A comment's lines: the picked ones on `side`, or the new side unless only removed lines were picked.
  static func draft(
    path: String, hunk: HunkData, indices: [Int], side: DiffReviewComment.Side?, scope: String
  ) -> DiffReviewComment? {
    let picked = Set(indices).sorted().map { hunk.lines[$0] }
    let side = side ?? (picked.contains { $0.type != .deletion } ? .new : .old)
    let onSide = picked.compactMap { line in number(line, side).map { (line, $0) } }
    guard let first = onSide.first?.1, let last = onSide.last?.1 else { return nil }
    return DiffReviewComment(
      path: path, side: side, lines: first...last, excerpt: onSide.map { $0.0.content }, hunk: text(of: hunk), scope: scope,
      body: "")
  }

  static func number(_ line: GroveKit.DiffLine, _ side: DiffReviewComment.Side) -> Int? {
    side == .new ? line.newLineNumber : line.oldLineNumber
  }

  /// The hunk as unified diff text.
  static func text(of hunk: HunkData) -> String {
    ([hunk.header] + hunk.lines.map { line in
      let sign = line.type == .addition ? "+" : line.type == .deletion ? "-" : " "
      return sign + line.content
    }).joined(separator: "\n")
  }

  /// Each comment that still sits in `diff`: the hunk and the line index it hangs under.
  static func anchors(_ comments: [DiffReviewComment], in diff: DiffResult) -> [Anchor] {
    comments.compactMap { comment in
      for (h, hunk) in diff.hunks.enumerated() {
        if let i = hunk.lines.firstIndex(where: { line in
          number(line, comment.side).map {
            comment.anchors(path: comment.path, side: comment.side, last: $0, text: line.content)
          } ?? false
        }) {
          return Anchor(comment: comment.id, hunk: h, line: i)
        }
      }
      return nil
    }
  }

  struct Anchor: Equatable {
    let comment: UUID
    let hunk: Int
    let line: Int
  }
}

extension DiffReviewContext {
  /// A file's drafts in the session's review, read from the store so the diff redraws when they change.
  @MainActor
  static func session(_ sessionId: String, path: String, scope: String, store: HostStore) -> DiffReviewContext {
    DiffReviewContext(
      scope: scope, comments: store.reviews.comments(sessionId, path: path),
      add: { store.addReviewComment($0, sessionId: sessionId) },
      update: { store.reviews.update($0, body: $1, sessionId: sessionId) },
      delete: { store.deleteReviewComment($0, sessionId: sessionId) })
  }
}
