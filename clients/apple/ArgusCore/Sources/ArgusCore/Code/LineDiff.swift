import Foundation

/// Line-level diffing for the editor: git gutter marks against `HEAD`, keeping the caret on the
/// same line across an external reload, and which lines to flash after an agent edit.
/// All line numbers are 0-based.
public enum LineDiff {
  /// A contiguous change: `old` lines of the base were replaced by `new` lines of the current
  /// text. One side is empty for a pure insertion or deletion.
  public struct Hunk: Sendable, Equatable {
    public let old: Range<Int>
    public let new: Range<Int>
  }

  public enum Mark: Sendable, Equatable {
    /// Lines that don't exist in the base.
    case added(Range<Int>)
    /// Lines that replaced base lines.
    case modified(Range<Int>)
    /// Base lines were removed after this line (-1: before the first line).
    case deleted(afterLine: Int)
  }

  public static func hunks(base: String, current: String) -> [Hunk] {
    hunks(old: lines(base), new: lines(current))
  }

  /// Gutter marks for `current`, compared with `base`. A replaced block marks its lines
  /// modified; any extra lines are added, any missing ones a deletion wedge after it.
  public static func marks(base: String, current: String) -> [Mark] {
    hunks(base: base, current: current).flatMap { hunk -> [Mark] in
      let paired = min(hunk.old.count, hunk.new.count)
      var marks: [Mark] = []
      if paired > 0 { marks.append(.modified(hunk.new.lowerBound..<hunk.new.lowerBound + paired)) }
      if hunk.new.count > paired { marks.append(.added(hunk.new.lowerBound + paired..<hunk.new.upperBound)) }
      if hunk.old.count > paired { marks.append(.deleted(afterLine: hunk.new.lowerBound + paired - 1)) }
      return marks
    }
  }

  /// Where line `oldLine` of `old` ended up in `new`. A line inside a changed block maps to the
  /// start of its replacement; the result is clamped to `new`'s lines.
  public static func mapLine(_ oldLine: Int, from old: String, to new: String) -> Int {
    let newCount = lines(new).count
    var shift = 0
    for hunk in hunks(base: old, current: new) {
      if oldLine < hunk.old.lowerBound { break }
      if oldLine < hunk.old.upperBound {
        return clamp(hunk.new.lowerBound + min(oldLine - hunk.old.lowerBound, max(hunk.new.count - 1, 0)), newCount)
      }
      shift = hunk.new.upperBound - hunk.old.upperBound
    }
    return clamp(oldLine + shift, newCount)
  }

  /// Ranges of `new` lines that are new or changed, to flash after a reload.
  public static func changedLines(from old: String, to new: String) -> [Range<Int>] {
    hunks(base: old, current: new).map(\.new).filter { !$0.isEmpty }
  }

  static func lines(_ text: String) -> [Substring] {
    text.split(separator: "\n", omittingEmptySubsequences: false)
  }

  static func hunks(old: [Substring], new: [Substring]) -> [Hunk] {
    let difference = new.difference(from: old)
    var removed = Set<Int>()
    var inserted = Set<Int>()
    for change in difference {
      switch change {
      case .remove(let offset, _, _): removed.insert(offset)
      case .insert(let offset, _, _): inserted.insert(offset)
      }
    }
    var hunks: [Hunk] = []
    var i = 0
    var j = 0
    while i < old.count || j < new.count {
      guard removed.contains(i) || inserted.contains(j) else {
        i += 1
        j += 1
        continue
      }
      let oldStart = i
      let newStart = j
      while removed.contains(i) { i += 1 }
      while inserted.contains(j) { j += 1 }
      hunks.append(Hunk(old: oldStart..<i, new: newStart..<j))
    }
    return hunks
  }

  private static func clamp(_ line: Int, _ count: Int) -> Int {
    max(0, min(line, count - 1))
  }
}
