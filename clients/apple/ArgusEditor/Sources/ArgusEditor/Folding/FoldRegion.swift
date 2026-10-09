import ArgusSyntax
import Foundation

/// A foldable block: `hidden` collapses into a placeholder, the rest of `startLine` stays.
struct FoldRegion: Equatable {
  var startLine: Int
  var endLine: Int
  var hidden: NSRange
}

/// Where fold regions come from, and how folded ranges follow edits. Pure, for the tests.
enum FoldRegions {
  /// Tree-sitter's regions as lines; one per start line (the outermost), like VS Code.
  static func fromSyntax(_ folds: [SyntaxFold], lines: LineIndex) -> [FoldRegion] {
    let regions = folds.compactMap { fold -> FoldRegion? in
      let start = lines.line(containing: fold.hidden.location)
      let end = lines.line(containing: NSMaxRange(fold.hidden))
      return end > start ? FoldRegion(startLine: start, endLine: end, hidden: fold.hidden) : nil
    }
    return outermostPerLine(regions)
  }

  /// For languages without a grammar (and Python/YAML, where VS Code folds by indentation too): a
  /// line folds the lines after it that are blank or indented deeper, up to the last such non-blank line.
  static func indentation(_ text: NSString, lines: LineIndex, tabWidth: Int) -> [FoldRegion] {
    let count = lines.lineCount
    var indents = [Int?](repeating: nil, count: count)
    for line in 0..<count { indents[line] = indent(of: line, in: text, lines: lines, tabWidth: tabWidth) }
    var regions: [FoldRegion] = []
    // Open regions as (start line, indent, last non-blank line inside).
    var stack: [(line: Int, indent: Int, last: Int)] = []
    func close(while condition: (Int) -> Bool) {
      while let top = stack.last, condition(top.indent) {
        stack.removeLast()
        guard top.last > top.line else { continue }
        let start = NSMaxRange(contentRange(top.line, text, lines))
        let end = NSMaxRange(contentRange(top.last, text, lines))
        regions.append(FoldRegion(startLine: top.line, endLine: top.last, hidden: NSRange(location: start, length: end - start)))
      }
    }
    for line in 0..<count {
      guard let indent = indents[line] else { continue }
      close { $0 >= indent }
      for index in stack.indices { stack[index].last = line }
      stack.append((line, indent, line))
    }
    close { _ in true }
    return regions.sorted { $0.startLine < $1.startLine }
  }

  /// Folded ranges after replacing `edit` with `newLength` units. An edit inside or overlapping a
  /// fold unfolds it; one before shifts it.
  static func map(_ folded: [NSRange], edit: NSRange, newLength: Int) -> [NSRange] {
    let delta = newLength - edit.length
    return folded.compactMap { range in
      if edit.length == 0 {
        if edit.location < range.location { return NSRange(location: range.location + delta, length: range.length) }
        return edit.location >= NSMaxRange(range) ? range : nil
      }
      if NSMaxRange(edit) <= range.location { return NSRange(location: range.location + delta, length: range.length) }
      return edit.location >= NSMaxRange(range) ? range : nil
    }
  }

  /// The folds the engine shows: nested folds inside a folded one are remembered, not displayed.
  static func topLevel(_ folded: [NSRange]) -> [NSRange] {
    var result: [NSRange] = []
    for range in folded.sorted(by: { ($0.location, -$0.length) < ($1.location, -$1.length) }) {
      if let last = result.last, range.location < NSMaxRange(last) { continue }
      result.append(range)
    }
    return result
  }

  private static func outermostPerLine(_ regions: [FoldRegion]) -> [FoldRegion] {
    var byLine: [Int: FoldRegion] = [:]
    for region in regions {
      if let existing = byLine[region.startLine], existing.hidden.length >= region.hidden.length { continue }
      byLine[region.startLine] = region
    }
    return byLine.values.sorted { $0.startLine < $1.startLine }
  }

  /// Leading whitespace width in columns, or nil for a blank line.
  private static func indent(of line: Int, in text: NSString, lines: LineIndex, tabWidth: Int) -> Int? {
    let range = contentRange(line, text, lines)
    var width = 0
    for offset in range.location..<NSMaxRange(range) {
      switch text.character(at: offset) {
      case 0x20: width += 1
      case 0x09: width += max(1, tabWidth) - width % max(1, tabWidth)
      default: return width
      }
    }
    return nil
  }

  /// The line without its line ending.
  private static func contentRange(_ line: Int, _ text: NSString, _ lines: LineIndex) -> NSRange {
    NSRange(location: lines.lineRange(line).location, length: lines.contentLength(ofLine: line, in: text))
  }
}
