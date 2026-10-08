import ArgusSyntax
import Foundation

/// A language's comment tokens, as VS Code's language configurations have them.
struct CommentTokens: Equatable {
  var line: String?
  var block: (open: String, close: String)?

  static func == (lhs: CommentTokens, rhs: CommentTokens) -> Bool {
    lhs.line == rhs.line && lhs.block?.open == rhs.block?.open && lhs.block?.close == rhs.block?.close
  }

  /// Nil for a language without comments (JSON) and for plain text.
  static func `for`(_ language: SyntaxLanguage?) -> CommentTokens? {
    guard let language else { return nil }
    switch language {
    case .swift, .typescript, .tsx, .javascript, .kotlin, .java, .objc, .go, .rust:
      return CommentTokens(line: "//", block: ("/*", "*/"))
    case .css: return CommentTokens(line: nil, block: ("/*", "*/"))
    case .html, .markdown: return CommentTokens(line: nil, block: ("<!--", "-->"))
    case .python: return CommentTokens(line: "#", block: ("\"\"\"", "\"\"\""))
    case .yaml, .bash, .ruby: return CommentTokens(line: "#", block: nil)
    case .json: return nil
    }
  }
}

enum CommentToggle {
  /// ⌘/: comments the selected lines at their shared indentation, or uncomments them when every
  /// non-blank one already is. Languages with only block comments wrap the lines in one.
  static func toggleLine(_ context: EditContext, tokens: CommentTokens) -> EditPlan? {
    guard let token = tokens.line else {
      guard let block = tokens.block else { return nil }
      let ranges = context.lineSpans().compactMap { span -> NSRange? in
        let lines = span.filter { !context.isBlank($0) }
        guard let first = lines.first, let last = lines.last else { return nil }
        let start = context.lineStart(first) + context.indentLength(first)
        return NSRange(location: start, length: context.contentEnd(last) - start)
      }
      return toggleBlock(context, ranges: ranges, block: block, selectInner: false)
    }
    let all = context.selectedLines()
    let nonBlank = all.filter { !context.isBlank($0) }
    let lines = nonBlank.isEmpty ? all : nonBlank
    let tokenLength = (token as NSString).length
    let commented = !nonBlank.isEmpty && lines.allSatisfy { line in
      let start = context.lineStart(line) + context.indentLength(line)
      return context.text.length >= start + tokenLength
        && context.text.substring(with: NSRange(location: start, length: tokenLength)) == token
    }
    let edits: [BufferEdit]
    if commented {
      edits = lines.map { line in
        let start = context.lineStart(line) + context.indentLength(line)
        let next = start + tokenLength
        let space = next < context.contentEnd(line) && context.text.character(at: next) == 0x20 ? 1 : 0
        return BufferEdit(range: NSRange(location: start, length: tokenLength + space), text: "")
      }
    } else {
      let column = lines.map(context.indentLength).min() ?? 0
      edits = lines.map { BufferEdit(range: NSRange(location: context.lineStart($0) + column, length: 0), text: token + " ") }
    }
    return EditPlan(edits: edits, selections: context.mapSelections(through: edits))
  }

  /// ⇧⌥A: wraps each selection in a block comment, or unwraps one that is (or sits inside) one.
  /// An empty selection gets an empty comment with the caret inside.
  static func toggleBlock(_ context: EditContext, tokens: CommentTokens) -> EditPlan? {
    guard let block = tokens.block else { return toggleLine(context, tokens: tokens) }
    return toggleBlock(context, ranges: context.selections, block: block, selectInner: true)
  }

  private static func toggleBlock(
    _ context: EditContext, ranges: [NSRange], block: (open: String, close: String), selectInner: Bool
  ) -> EditPlan? {
    guard !ranges.isEmpty else { return nil }
    let text = context.text
    let open = block.open + " "
    let close = " " + block.close
    var edits: [BufferEdit] = []
    for range in ranges {
      let selected = text.substring(with: range)
      let trimmed = selected.trimmingCharacters(in: .whitespacesAndNewlines)
      if range.length > 0, trimmed.hasPrefix(block.open), trimmed.hasSuffix(block.close),
        trimmed.count >= block.open.count + block.close.count
      {
        let lead = (selected as NSString).range(of: block.open)
        let trail = (selected as NSString).range(of: block.close, options: .backwards)
        let openEdit = removal(text, at: range.location + lead.location, token: block.open, trailingSpace: true)
        let closeEdit = removal(text, at: range.location + trail.location, token: block.close, trailingSpace: false)
        edits += [openEdit, closeEdit]
      } else if let around = surrounding(text, range: range, open: block.open, close: block.close) {
        edits += [around.open, around.close]
      } else {
        let start = BufferEdit(range: NSRange(location: range.location, length: 0), text: range.length > 0 ? open : open + " ")
        let end = BufferEdit(range: NSRange(location: NSMaxRange(range), length: 0), text: range.length > 0 ? close : block.close)
        if range.length > 0 { edits += [start, end] } else { edits.append(BufferEdit(range: start.range, text: start.text + end.text)) }
      }
    }
    let selections =
      selectInner
      ? ranges.map { range in
        let start = EditContext.map(range.location, through: edits, stickBefore: false)
        guard range.length > 0 else {
          return NSRange(location: EditContext.map(range.location, through: edits, stickBefore: true) + (open as NSString).length, length: 0)
        }
        let end = EditContext.map(NSMaxRange(range), through: edits, stickBefore: true)
        return NSRange(location: start, length: max(0, end - start))
      }
      : context.mapSelections(through: edits)
    return EditPlan(edits: edits, selections: selections)
  }

  /// `token` at `location`, plus the space that pads it on the inner side.
  private static func removal(_ text: NSString, at location: Int, token: String, trailingSpace: Bool) -> BufferEdit {
    let length = (token as NSString).length
    if trailingSpace {
      let next = location + length
      let space = next < text.length && text.character(at: next) == 0x20 ? 1 : 0
      return BufferEdit(range: NSRange(location: location, length: length + space), text: "")
    }
    let space = location > 0 && text.character(at: location - 1) == 0x20 ? 1 : 0
    return BufferEdit(range: NSRange(location: location - space, length: length + space), text: "")
  }

  /// The comment tokens right around `range` (spaces allowed between), when there are.
  private static func surrounding(
    _ text: NSString, range: NSRange, open: String, close: String
  ) -> (open: BufferEdit, close: BufferEdit)? {
    var before = range.location
    while before > 0, text.character(at: before - 1) == 0x20 { before -= 1 }
    var after = NSMaxRange(range)
    while after < text.length, text.character(at: after) == 0x20 { after += 1 }
    let openLength = (open as NSString).length
    let closeLength = (close as NSString).length
    guard before >= openLength, after + closeLength <= text.length,
      text.substring(with: NSRange(location: before - openLength, length: openLength)) == open,
      text.substring(with: NSRange(location: after, length: closeLength)) == close
    else { return nil }
    return (
      BufferEdit(range: NSRange(location: before - openLength, length: range.location - before + openLength), text: ""),
      BufferEdit(range: NSRange(location: NSMaxRange(range), length: after + closeLength - NSMaxRange(range)), text: "")
    )
  }
}
