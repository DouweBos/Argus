import Foundation

/// Whole-line commands: move, copy, delete, insert, indent and select. Pure, so they're tested
/// without a view.
enum LineEditing {
  // MARK: Move and copy

  /// ⌥↑ / ⌥↓: swaps each block of selected lines with the line past it. Nil at the edge.
  static func moveLines(_ context: EditContext, up: Bool) -> EditPlan? {
    let spans = context.lineSpans()
    guard let first = spans.first, let last = spans.last else { return nil }
    if up ? first.lowerBound == 0 : last.upperBound >= context.lineCount - 1 { return nil }
    let edits = spans.map { span in
      let region = up ? (span.lowerBound - 1)...span.upperBound : span.lowerBound...(span.upperBound + 1)
      var contents = region.map(context.content)
      if up { contents.append(contents.removeFirst()) } else { contents.insert(contents.removeLast(), at: 0) }
      let start = context.lineStart(region.lowerBound)
      let end = NSMaxRange(context.lines.lineRange(region.upperBound))
      return BufferEdit(
        range: NSRange(location: start, length: end - start),
        text: contents.joined(separator: context.eol) + context.terminator(region.upperBound))
    }
    return EditPlan(edits: edits, selections: shiftLines(context, edits: edits) { _ in up ? -1 : 1 })
  }

  /// ⇧⌥↑ / ⇧⌥↓: duplicates each block; the selection follows the copy below, or stays on the one above.
  static func copyLines(_ context: EditContext, up: Bool) -> EditPlan {
    let spans = context.lineSpans()
    let edits = spans.map { span in
      BufferEdit(
        range: NSRange(location: context.lineStart(span.lowerBound), length: 0),
        text: span.map(context.content).joined(separator: context.eol) + context.eol)
    }
    return EditPlan(
      edits: edits,
      selections: shiftLines(context, edits: edits) { line in
        let span = spans.first { $0.contains(line) }
        let inserted = spans.filter { $0.upperBound < line }.reduce(0) { $0 + $1.count }
        return inserted + (up ? 0 : span?.count ?? 0)
      })
  }

  /// Rebuilds the selections in the edited text, each endpoint moved by `lineDelta(line)` lines,
  /// columns kept.
  private static func shiftLines(
    _ context: EditContext, edits: [BufferEdit], lineDelta: (Int) -> Int
  ) -> [NSRange] {
    let result = EditContext.apply(edits, to: context.text)
    let index = LineIndex(result)
    return context.selections.map { selection in
      let span = context.lineSpan(of: selection)
      let delta = lineDelta(span.lowerBound)
      func moved(_ offset: Int) -> Int {
        let position = context.lines.position(of: offset)
        return index.offset(of: EditorPosition(line: position.line + delta, utf16Column: position.utf16Column), in: result)
      }
      let start = moved(selection.location)
      let end = selection.length > 0 ? moved(NSMaxRange(selection)) : start
      return NSRange(location: start, length: max(0, end - start))
    }
  }

  // MARK: Delete and insert

  /// ⇧⌘K: removes every selected line; the caret keeps its column on the line that moves up.
  static func deleteLines(_ context: EditContext) -> EditPlan {
    let spans = context.lineSpans()
    let edits = spans.map { span -> BufferEdit in
      if span.upperBound < context.lineCount - 1 {
        let start = context.lineStart(span.lowerBound)
        return BufferEdit(range: NSRange(location: start, length: context.lineStart(span.upperBound + 1) - start), text: "")
      }
      // The last line has no break of its own: take the one before it.
      let start = span.lowerBound > 0 ? context.contentEnd(span.lowerBound - 1) : 0
      return BufferEdit(range: NSRange(location: start, length: context.text.length - start), text: "")
    }
    let result = EditContext.apply(edits, to: context.text)
    let index = LineIndex(result)
    var removed = 0
    var carets: [NSRange] = []
    for span in spans {
      let column = context.selections.first { span.contains(context.lineSpan(of: $0).lowerBound) }
        .map { context.lines.position(of: $0.location).utf16Column } ?? 0
      let line = min(span.lowerBound - removed, index.lineCount - 1)
      carets.append(NSRange(location: index.offset(of: EditorPosition(line: line, utf16Column: column), in: result), length: 0))
      removed += span.count
    }
    return EditPlan(edits: edits, selections: carets)
  }

  /// ⌘↩ / ⇧⌘↩: a new line below or above each caret's line, at that line's indentation.
  static func insertLine(_ context: EditContext, below: Bool) -> EditPlan {
    let targets = Array(Set(context.selections.map { context.lineSpan(of: $0).upperBound })).sorted()
    let edits = targets.map { line -> BufferEdit in
      let indent = (context.content(line) as NSString).substring(to: context.indentLength(line))
      if below {
        let opens = context.content(line).trimmingCharacters(in: .whitespaces).last.map { "{([".contains($0) } ?? false
        let text = context.eol + indent + (opens ? context.configuration.indentUnit : "")
        return BufferEdit(range: NSRange(location: context.contentEnd(line), length: 0), text: text)
      }
      return BufferEdit(range: NSRange(location: context.lineStart(line), length: 0), text: indent + context.eol)
    }
    let result = EditContext.apply(edits, to: context.text)
    let index = LineIndex(result)
    let carets = zip(targets, edits).enumerated().map { offset, pair in
      let (line, edit) = pair
      let newLine = line + offset + (below ? 1 : 0)
      let column = below ? (edit.text as NSString).length - (context.eol as NSString).length : context.indentLength(line)
      return NSRange(location: index.offset(of: EditorPosition(line: newLine, utf16Column: column), in: result), length: 0)
    }
    return EditPlan(edits: edits, selections: carets)
  }

  // MARK: Indentation

  /// ⌘] (and Tab over several lines): one indent step at the start of each selected line.
  /// Empty lines stay empty unless the caret is on one.
  static func indent(_ context: EditContext) -> EditPlan {
    let lines = context.selectedLines()
    let unit = context.configuration.indentUnit
    let edits = lines.filter { lines.count == 1 || context.lines.contentLength(ofLine: $0, in: context.text) > 0 }
      .map { BufferEdit(range: NSRange(location: context.lineStart($0), length: 0), text: unit) }
    return EditPlan(edits: edits, selections: context.mapSelections(through: edits))
  }

  /// ⌘[ / ⇧Tab: removes one tab, or spaces back to the previous tab stop.
  static func outdent(_ context: EditContext) -> EditPlan? {
    let width = max(1, context.configuration.tabWidth)
    let edits = context.selectedLines().compactMap { line -> BufferEdit? in
      let start = context.lineStart(line)
      let end = context.contentEnd(line)
      guard start < end else { return nil }
      if context.text.character(at: start) == 0x09 { return BufferEdit(range: NSRange(location: start, length: 1), text: "") }
      var spaces = 0
      while start + spaces < end, context.text.character(at: start + spaces) == 0x20 { spaces += 1 }
      guard spaces > 0 else { return nil }
      let remove = spaces % width == 0 ? width : spaces % width
      return BufferEdit(range: NSRange(location: start, length: min(remove, spaces)), text: "")
    }
    guard !edits.isEmpty else { return nil }
    return EditPlan(edits: edits, selections: context.mapSelections(through: edits))
  }

  // MARK: Selection

  /// ⌘L: selects each selection's whole lines; pressed again, takes the next line too.
  static func selectLine(_ context: EditContext) -> EditPlan {
    let selections = context.selections.map { selection -> NSRange in
      let end = NSMaxRange(selection)
      let startLine = context.lines.line(containing: selection.location)
      let endLine = context.lines.line(containing: end)
      let coversWholeLines =
        selection.length > 0 && selection.location == context.lineStart(startLine) && end == context.lineStart(endLine)
        && endLine > startLine
      let lastLine = coversWholeLines ? endLine : context.lineSpan(of: selection).upperBound
      let start = context.lineStart(startLine)
      return NSRange(location: start, length: NSMaxRange(context.lines.lineRange(lastLine)) - start)
    }
    return EditPlan(selections: selections, reveal: selections.last.map { NSRange(location: NSMaxRange($0), length: 0) })
  }
}
