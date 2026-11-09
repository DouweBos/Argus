import ArgusCore
import Foundation
import GroveKit

/// How a diff lays out its lines. `inline` is the unified diff; the raw value
/// predates the name.
enum DiffLayout: String, CaseIterable, Identifiable {
  case inline
  case split

  var id: Self { self }
  var title: String { self == .inline ? "Unified" : "Split" }
  var symbol: String { self == .inline ? "text.justify.left" : "rectangle.split.2x1" }
  /// The host's and Electron's name for it.
  var telemetryName: String { self == .inline ? "unified" : "split" }
}

/// The unified layout's line-number gutters: a new file's lines have no old
/// numbers, a deleted file's no new ones, so it drops the empty gutter.
enum DiffGutters: Equatable {
  case both
  case old
  case new

  var count: Int { self == .both ? 2 : 1 }
}

/// Which hunk actions a diff offers: the working copy's two sides, or none.
enum DiffActions {
  case unstaged
  case staged
}

/// One table row of a diff: a hunk header, or a line (inline) or a pair of
/// lines (split). Indices point into `DiffResult.hunks[hunk].lines`.
struct DiffRow: Equatable {
  enum Kind: Equatable {
    case header
    case line(Int)
    case pair(left: Int?, right: Int?)
    /// A draft review comment, under the line it's about.
    case comment(UUID)
  }

  let hunk: Int
  let kind: Kind
}

/// Flattens a diff into rows once, so the table only looks rows up.
@MainActor
enum DiffRowBuilder {
  static func rows(for diff: DiffResult, layout: DiffLayout, comments: [DiffReviewAnchors.Anchor] = []) -> [DiffRow] {
    var rows: [DiffRow] = []
    rows.reserveCapacity(diff.hunks.reduce(0) { $0 + $1.lines.count + 1 } + comments.count)
    for (h, hunk) in diff.hunks.enumerated() {
      rows.append(DiffRow(hunk: h, kind: .header))
      let under = Dictionary(grouping: comments.filter { $0.hunk == h }, by: \.line)
      func commentRows(_ i: Int?) {
        guard let i else { return }
        rows.append(contentsOf: (under[i] ?? []).map { DiffRow(hunk: h, kind: .comment($0.comment)) })
      }
      switch layout {
      case .inline:
        for i in hunk.lines.indices {
          rows.append(DiffRow(hunk: h, kind: .line(i)))
          commentRows(i)
        }
      case .split:
        for (left, right) in pairs(hunk.lines) {
          rows.append(DiffRow(hunk: h, kind: .pair(left: left, right: right)))
          commentRows(left)
          if right != left { commentRows(right) }
        }
      }
    }
    return rows
  }

  /// Context lines sit on both sides; a run of deletions pairs up with the
  /// run of additions after it, the longer run leaving blanks opposite.
  static func pairs(_ lines: [GroveKit.DiffLine]) -> [(Int?, Int?)] {
    var result: [(Int?, Int?)] = []
    var i = 0
    while i < lines.count {
      switch lines[i].type {
      case .context:
        result.append((i, i))
        i += 1
      case .deletion, .addition:
        var deletions: [Int] = []
        var additions: [Int] = []
        while i < lines.count, lines[i].type == .deletion {
          deletions.append(i)
          i += 1
        }
        while i < lines.count, lines[i].type == .addition {
          additions.append(i)
          i += 1
        }
        for k in 0..<max(deletions.count, additions.count) {
          result.append((k < deletions.count ? deletions[k] : nil, k < additions.count ? additions[k] : nil))
        }
      }
    }
    return result
  }

  /// Only additions or only deletions: nothing to set side by side, so even
  /// the split layout shows one column.
  static func isOneSided(_ diff: DiffResult) -> Bool {
    var additions = false
    var deletions = false
    for hunk in diff.hunks {
      for line in hunk.lines {
        if line.type == .addition { additions = true }
        if line.type == .deletion { deletions = true }
        if additions && deletions { return false }
      }
    }
    return true
  }

  static func gutters(for diff: DiffResult) -> DiffGutters {
    let lines = diff.hunks.lazy.flatMap(\.lines)
    if !lines.contains(where: { $0.oldLineNumber != nil }) { return .new }
    if !lines.contains(where: { $0.newLineNumber != nil }) { return .old }
    return .both
  }

  /// The longest line, in characters, for the inline layout's scroll width.
  static func widestLine(in diff: DiffResult) -> Int {
    diff.hunks.reduce(0) { widest, hunk in
      hunk.lines.reduce(widest) { max($0, $1.content.count) }
    }
  }
}
