import Foundation

/// One replacement, `range` in the text before any of a plan's edits.
struct BufferEdit: Equatable {
  var range: NSRange
  var text: String

  var delta: Int { (text as NSString).length - range.length }
}

/// What a command does: non-overlapping edits applied as one undo group, then the selections
/// (in the edited text).
struct EditPlan: Equatable {
  var edits: [BufferEdit]
  var selections: [NSRange]
  /// Scrolled into view afterwards; the first selection when nil.
  var reveal: NSRange?

  init(edits: [BufferEdit] = [], selections: [NSRange], reveal: NSRange? = nil) {
    self.edits = edits
    self.selections = selections
    self.reveal = reveal
  }
}

/// The text and selections a command works from, plus the line helpers every command needs.
struct EditContext {
  let text: NSString
  let lines: LineIndex
  /// Sorted by location.
  let selections: [NSRange]
  let configuration: EditorConfiguration

  init(text: NSString, selections: [NSRange], configuration: EditorConfiguration = .default, lines: LineIndex? = nil) {
    self.text = text
    self.lines = lines ?? LineIndex(text)
    self.selections = selections.isEmpty ? [NSRange(location: 0, length: 0)] : selections.sorted { $0.location < $1.location }
    self.configuration = configuration
  }

  var eol: String { SaveTransform.lineEnding(of: text) }
  var lineCount: Int { lines.lineCount }

  func lineStart(_ line: Int) -> Int { lines.lineRange(line).location }
  func contentEnd(_ line: Int) -> Int { lineStart(line) + lines.contentLength(ofLine: line, in: text) }
  func content(_ line: Int) -> String {
    text.substring(with: NSRange(location: lineStart(line), length: lines.contentLength(ofLine: line, in: text)))
  }

  /// The line break ending `line`; empty for the last line.
  func terminator(_ line: Int) -> String {
    let range = lines.lineRange(line)
    return text.substring(with: NSRange(location: contentEnd(line), length: NSMaxRange(range) - contentEnd(line)))
  }

  /// Leading spaces and tabs.
  func indentLength(_ line: Int) -> Int {
    let start = lineStart(line)
    let end = contentEnd(line)
    var offset = start
    while offset < end, [0x20, 0x09].contains(text.character(at: offset)) { offset += 1 }
    return offset - start
  }

  func isBlank(_ line: Int) -> Bool { indentLength(line) == lines.contentLength(ofLine: line, in: text) }

  /// The lines a selection covers; one ending at the start of a line doesn't take that line.
  func lineSpan(of selection: NSRange) -> ClosedRange<Int> {
    let first = lines.line(containing: selection.location)
    var last = lines.line(containing: NSMaxRange(selection))
    if selection.length > 0, last > first, NSMaxRange(selection) == lineStart(last) { last -= 1 }
    return first...last
  }

  /// Every selection's lines, overlapping and touching spans merged.
  func lineSpans() -> [ClosedRange<Int>] {
    var spans: [ClosedRange<Int>] = []
    for span in selections.map(lineSpan(of:)).sorted(by: { $0.lowerBound < $1.lowerBound }) {
      if let last = spans.last, span.lowerBound <= last.upperBound + 1 {
        spans[spans.count - 1] = last.lowerBound...max(last.upperBound, span.upperBound)
      } else {
        spans.append(span)
      }
    }
    return spans
  }

  /// The selected lines, each once.
  func selectedLines() -> [Int] { lineSpans().flatMap { Array($0) } }

  /// Where `offset` lands once `edits` are applied. An insertion exactly at `offset` pushes it
  /// along unless `stickBefore`.
  static func map(_ offset: Int, through edits: [BufferEdit], stickBefore: Bool = false) -> Int {
    var shift = 0
    for edit in edits.sorted(by: { $0.range.location < $1.range.location }) {
      let range = edit.range
      if offset > NSMaxRange(range) || (offset == NSMaxRange(range) && range.length > 0) {
        shift += edit.delta
      } else if offset == range.location, range.length == 0 {
        if !stickBefore { shift += edit.delta }
      } else if offset > range.location {
        return range.location + shift + min(offset - range.location, (edit.text as NSString).length)
      } else {
        break
      }
    }
    return offset + shift
  }

  /// Every selection carried through `edits`; a selection keeps text inserted at its start.
  func mapSelections(through edits: [BufferEdit]) -> [NSRange] {
    selections.map { selection in
      let start = Self.map(selection.location, through: edits, stickBefore: selection.length > 0)
      let end = selection.length > 0 ? Self.map(NSMaxRange(selection), through: edits, stickBefore: true) : start
      return NSRange(location: start, length: max(0, end - start))
    }
  }

  static func apply(_ edits: [BufferEdit], to text: NSString) -> NSString {
    let result = NSMutableString(string: text)
    for edit in edits.sorted(by: { $0.range.location > $1.range.location }) {
      result.replaceCharacters(in: edit.range, with: edit.text)
    }
    return result
  }
}
