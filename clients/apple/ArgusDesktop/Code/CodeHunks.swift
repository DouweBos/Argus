import ArgusCore
import ArgusEditor
import Foundation
import GroveKit

/// A buffer against a base text (`HEAD`, or the disk for Compare), hunk by
/// hunk: the gutter's marks, putting one hunk back, the patch `discard_hunk`
/// reverses, and a `DiffResult` for the diff view. Lines are 0-based and split
/// on `\n` with a trailing empty element for a final newline, as `LineDiff` has them.
struct CodeHunks {
  let base: String
  let current: String
  let hunks: [LineDiff.Hunk]
  private let baseLines: [Substring]
  private let currentLines: [Substring]

  init(base: String, current: String) {
    self.base = base
    self.current = current
    hunks = LineDiff.hunks(base: base, current: current)
    baseLines = base.split(separator: "\n", omittingEmptySubsequences: false)
    currentLines = current.split(separator: "\n", omittingEmptySubsequences: false)
  }

  // MARK: Gutter

  var marks: [GutterMark] { hunks.map(mark(for:)) }

  func mark(for hunk: LineDiff.Hunk) -> GutterMark {
    let kind: GutterMark.Kind = hunk.old.isEmpty ? .added : hunk.new.isEmpty ? .deleted : .modified
    return GutterMark(
      id: Self.id(of: hunk), kind: kind, lines: hunk.new.isEmpty ? hunk.new.lowerBound..<hunk.new.lowerBound : hunk.new,
      baseLines: baseLines[clamped(hunk.old, baseLines.count)].map(String.init))
  }

  func hunk(for mark: GutterMark) -> LineDiff.Hunk? {
    hunks.first { Self.id(of: $0) == mark.id }
  }

  private static func id(of hunk: LineDiff.Hunk) -> String {
    "\(hunk.old.lowerBound),\(hunk.old.count):\(hunk.new.lowerBound),\(hunk.new.count)"
  }

  // MARK: Reverting

  /// The current text with `hunk` put back the way the base has it.
  func reverting(_ hunk: LineDiff.Hunk) -> String {
    var lines = currentLines
    lines.replaceSubrange(clamped(hunk.new, lines.count), with: baseLines[clamped(hunk.old, baseLines.count)])
    return lines.joined(separator: "\n")
  }

  /// The one replacement that turns `old` into `new`: everything between their common prefix
  /// and suffix, as a UTF-16 range of `old`.
  static func edit(from old: String, to new: String) -> (range: NSRange, text: String) {
    let a = old as NSString
    let b = new as NSString
    var prefix = 0
    let limit = min(a.length, b.length)
    while prefix < limit, a.character(at: prefix) == b.character(at: prefix) { prefix += 1 }
    // Never split a surrogate pair.
    if prefix > 0, prefix < limit, UTF16.isLeadSurrogate(a.character(at: prefix - 1)) { prefix -= 1 }
    var suffix = 0
    while suffix < limit - prefix, a.character(at: a.length - 1 - suffix) == b.character(at: b.length - 1 - suffix) {
      suffix += 1
    }
    if suffix > 0, suffix < limit - prefix, UTF16.isTrailSurrogate(a.character(at: a.length - suffix)) { suffix -= 1 }
    let range = NSRange(location: prefix, length: a.length - prefix - suffix)
    return (range, b.substring(with: NSRange(location: prefix, length: b.length - prefix - suffix)))
  }

  // MARK: Patch

  /// `hunk` as a unified diff from the base to the current text, with up to `context` unchanged
  /// lines around it. Nil when it reaches a missing final newline: `git apply` needs a marker
  /// there that a line diff can't place reliably, so the caller reverts in the buffer instead.
  func patch(for hunk: LineDiff.Hunk, path: String, context: Int = 3) -> String? {
    guard let index = hunks.firstIndex(of: hunk) else { return nil }
    let baseCount = Self.realCount(base, baseLines)
    let currentCount = Self.realCount(current, currentLines)
    guard hunk.old.upperBound <= baseCount, hunk.new.upperBound <= currentCount else { return nil }
    let previousEnd = index > 0 ? hunks[index - 1].new.upperBound : 0
    let nextStart = index + 1 < hunks.count ? hunks[index + 1].new.lowerBound : currentCount
    let before = max(previousEnd, hunk.new.lowerBound - context)..<hunk.new.lowerBound
    let after = hunk.new.upperBound..<max(hunk.new.upperBound, min(nextStart, hunk.new.upperBound + context, currentCount))
    let endsWithNewline = { (text: String) in text.isEmpty || text.hasSuffix("\n") }
    if after.upperBound == currentCount, !endsWithNewline(base) || !endsWithNewline(current) { return nil }

    var body = ""
    for line in currentLines[before] { body += " \(line)\n" }
    for line in baseLines[hunk.old] { body += "-\(line)\n" }
    for line in currentLines[hunk.new] { body += "+\(line)\n" }
    for line in currentLines[after] { body += " \(line)\n" }
    let oldCount = before.count + hunk.old.count + after.count
    let newCount = before.count + hunk.new.count + after.count
    let oldStart = hunk.old.lowerBound - before.count
    let newStart = hunk.new.lowerBound - before.count
    let range = { (start: Int, count: Int) in "\(count == 0 ? start : start + 1),\(count)" }
    return """
      diff --git a/\(path) b/\(path)
      --- a/\(path)
      +++ b/\(path)
      @@ -\(range(oldStart, oldCount)) +\(range(newStart, newCount)) @@

      """ + body
  }

  /// Lines that end in a newline or are the last line; a final newline's empty tail isn't one.
  private static func realCount(_ text: String, _ lines: [Substring]) -> Int {
    text.isEmpty || text.hasSuffix("\n") ? lines.count - 1 : lines.count
  }

  // MARK: Diff view

  /// Every hunk with `context` lines around it, overlapping ones merged, for `DiffPane`.
  @MainActor func diffResult(path: String, context: Int = 3) -> DiffResult {
    var groups: [[LineDiff.Hunk]] = []
    for hunk in hunks {
      if let last = groups.last?.last, hunk.new.lowerBound - last.new.upperBound <= 2 * context {
        groups[groups.count - 1].append(hunk)
      } else {
        groups.append([hunk])
      }
    }
    var additions = 0
    var deletions = 0
    let result = groups.enumerated().map { index, group -> HunkData in
      let first = group[0]
      let last = group[group.count - 1]
      let start = max(0, first.new.lowerBound - context)
      let oldStart = first.old.lowerBound - (first.new.lowerBound - start)
      let end = min(currentLines.count, last.new.upperBound + context)
      var lines: [GroveKit.DiffLine] = []
      var oldLine = oldStart
      var newLine = start
      @MainActor func add(_ type: DiffLineType, _ text: Substring) {
        let id = "\(index):\(lines.count)"
        switch type {
        case .context:
          lines.append(.init(id: id, type: type, content: String(text), oldLineNumber: oldLine + 1, newLineNumber: newLine + 1))
          oldLine += 1
          newLine += 1
        case .deletion:
          lines.append(.init(id: id, type: type, content: String(text), oldLineNumber: oldLine + 1))
          oldLine += 1
          deletions += 1
        default:
          lines.append(.init(id: id, type: type, content: String(text), newLineNumber: newLine + 1))
          newLine += 1
          additions += 1
        }
      }
      for hunk in group {
        while newLine < hunk.new.lowerBound { add(.context, currentLines[newLine]) }
        for line in baseLines[clamped(hunk.old, baseLines.count)] { add(.deletion, line) }
        for line in currentLines[clamped(hunk.new, currentLines.count)] { add(.addition, line) }
      }
      while newLine < end { add(.context, currentLines[newLine]) }
      let oldCount = oldLine - oldStart
      let newCount = newLine - start
      let header = "@@ -\(oldStart + 1),\(oldCount) +\(start + 1),\(newCount) @@"
      return HunkData(
        id: "\(index):\(header)", header: header, oldStart: oldStart + 1, oldCount: oldCount, newStart: start + 1,
        newCount: newCount, lines: lines)
    }
    return DiffResult(
      filePath: path, hunks: result, stats: DiffStats(additions: additions, deletions: deletions))
  }

  private func clamped(_ range: Range<Int>, _ count: Int) -> Range<Int> {
    range.clamped(to: 0..<count)
  }
}
