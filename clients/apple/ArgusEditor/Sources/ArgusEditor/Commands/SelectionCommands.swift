import Foundation

/// Multi-cursor and navigation commands that only move selections.
enum SelectionCommands {
  // MARK: Occurrences

  /// ⌘D: carets first take the word they're on; then the next match of the last selection is added,
  /// wrapping at the end. Whole words only when the selection is one.
  static func addNextOccurrence(_ context: EditContext) -> EditPlan? {
    if context.selections.allSatisfy({ $0.length == 0 }) {
      let words = context.selections.map { word(at: $0.location, in: context.text) ?? $0 }
      guard words.contains(where: { $0.length > 0 }) else { return nil }
      return EditPlan(selections: words)
    }
    guard let last = context.selections.last(where: { $0.length > 0 }) else { return nil }
    let needle = context.text.substring(with: last)
    let wholeWord = isWholeWord(last, in: context.text)
    let after = NSMaxRange(context.selections.last!)
    let candidates =
      matches(of: needle, in: context.text, wholeWord: wholeWord, from: after)
      + matches(of: needle, in: context.text, wholeWord: wholeWord, from: 0, before: after)
    guard
      let next = candidates.first(where: { match in
        !context.selections.contains { NSIntersectionRange($0, match).length > 0 || $0 == match }
      })
    else { return nil }
    return EditPlan(selections: context.selections + [next], reveal: next)
  }

  /// ⇧⌘L: every match of the selection (or the word at the caret).
  static func selectAllOccurrences(_ context: EditContext) -> EditPlan? {
    let source = context.selections.first(where: { $0.length > 0 }) ?? context.selections.first.flatMap { word(at: $0.location, in: context.text) }
    guard let source, source.length > 0 else { return nil }
    let all = matches(of: context.text.substring(with: source), in: context.text, wholeWord: isWholeWord(source, in: context.text), from: 0)
    guard !all.isEmpty else { return nil }
    return EditPlan(selections: all, reveal: source)
  }

  static func matches(of needle: String, in text: NSString, wholeWord: Bool, from start: Int, before end: Int? = nil) -> [NSRange] {
    let limit = min(end ?? text.length, text.length)
    var found: [NSRange] = []
    var location = start
    while location < limit {
      let match = text.range(of: needle, options: .literal, range: NSRange(location: location, length: limit - location))
      guard match.location != NSNotFound else { break }
      if !wholeWord || isWholeWord(match, in: text) { found.append(match) }
      location = NSMaxRange(match)
    }
    return found
  }

  // MARK: Words

  static func isWordCharacter(_ c: unichar) -> Bool {
    c == 0x5F || (Unicode.Scalar(c).map { CharacterSet.alphanumerics.contains($0) } ?? false)
  }

  /// The identifier at `offset`, or ending right before it.
  static func word(at offset: Int, in text: NSString) -> NSRange? {
    var anchor = offset
    if anchor >= text.length || !isWordCharacter(text.character(at: anchor)) {
      guard anchor > 0, anchor - 1 < text.length, isWordCharacter(text.character(at: anchor - 1)) else { return nil }
      anchor -= 1
    }
    var start = anchor
    while start > 0, isWordCharacter(text.character(at: start - 1)) { start -= 1 }
    var end = anchor + 1
    while end < text.length, isWordCharacter(text.character(at: end)) { end += 1 }
    return NSRange(location: start, length: end - start)
  }

  /// All identifier characters, with none touching either side.
  static func isWholeWord(_ range: NSRange, in text: NSString) -> Bool {
    guard range.length > 0 else { return false }
    for offset in range.location..<NSMaxRange(range) where !isWordCharacter(text.character(at: offset)) { return false }
    let left = range.location == 0 || !isWordCharacter(text.character(at: range.location - 1))
    let right = NSMaxRange(range) >= text.length || !isWordCharacter(text.character(at: NSMaxRange(range)))
    return left && right
  }

  // MARK: Cursors

  /// ⌥⌘↑ / ⌥⌘↓: a caret on the line above or below each selection's end, same column where it fits.
  static func addCursor(_ context: EditContext, up: Bool) -> EditPlan? {
    let added = context.selections.compactMap { selection -> NSRange? in
      let position = context.lines.position(of: NSMaxRange(selection))
      let line = position.line + (up ? -1 : 1)
      guard line >= 0, line < context.lineCount else { return nil }
      let offset = context.lines.offset(of: EditorPosition(line: line, utf16Column: position.utf16Column), in: context.text)
      return NSRange(location: offset, length: 0)
    }
    let fresh = added.filter { range in !context.selections.contains { NSLocationInRange(range.location, $0) || $0 == range } }
    guard !fresh.isEmpty else { return nil }
    let reveal = up ? fresh.min { $0.location < $1.location } : fresh.max { $0.location < $1.location }
    return EditPlan(selections: context.selections + fresh, reveal: reveal)
  }

  // MARK: Brackets

  private static let pairs: [unichar: (match: unichar, forward: Bool)] = [
    0x28: (0x29, true), 0x5B: (0x5D, true), 0x7B: (0x7D, true),
    0x29: (0x28, false), 0x5D: (0x5B, false), 0x7D: (0x7B, false),
  ]

  /// ⇧⌘\: the bracket matching the one at (or just before) `offset`; otherwise the bracket that
  /// opens the block `offset` is in.
  static func matchingBracket(in text: NSString, at offset: Int) -> Int? {
    for candidate in [offset, offset - 1] where candidate >= 0 && candidate < text.length {
      if pairs[text.character(at: candidate)] != nil { return match(of: candidate, in: text) }
    }
    var depth: [unichar: Int] = [:]
    var index = min(offset, text.length) - 1
    while index >= 0 {
      let c = text.character(at: index)
      if let pair = pairs[c] {
        let opener = pair.forward ? c : pair.match
        if pair.forward {
          if depth[opener, default: 0] == 0 { return index }
          depth[opener, default: 0] -= 1
        } else {
          depth[opener, default: 0] += 1
        }
      }
      index -= 1
    }
    return nil
  }

  private static func match(of index: Int, in text: NSString) -> Int? {
    let open = text.character(at: index)
    guard let pair = pairs[open] else { return nil }
    var depth = 0
    var cursor = index
    while cursor >= 0, cursor < text.length {
      let c = text.character(at: cursor)
      if c == open { depth += 1 } else if c == pair.match { depth -= 1 }
      if depth == 0 { return cursor }
      cursor += pair.forward ? 1 : -1
    }
    return nil
  }

  // MARK: Problems

  /// F8 / ⇧F8: the next (or previous) diagnostic from `position`, wrapping round the file.
  static func diagnostic(
    in diagnostics: [EditorDiagnostic], from position: EditorPosition, forward: Bool
  ) -> EditorDiagnostic? {
    let sorted = diagnostics.sorted { ($0.range.start, $0.severity) < ($1.range.start, $1.severity) }
    if forward { return sorted.first { $0.range.start > position } ?? sorted.first }
    return sorted.last { $0.range.start < position } ?? sorted.last
  }
}

/// "Go to Line…" input: `line` or `line:column`, both 1-based.
public struct GoToLineTarget: Equatable, Sendable {
  public var line: Int
  public var column: Int?

  public init(line: Int, column: Int? = nil) {
    self.line = line
    self.column = column
  }

  public init?(_ input: String) {
    let parts = input.trimmingCharacters(in: .whitespaces).split(separator: ":", omittingEmptySubsequences: false)
      .map { $0.trimmingCharacters(in: .whitespaces) }
    guard (1...2).contains(parts.count), let line = Int(parts[0]), line > 0 else { return nil }
    self.line = line
    if parts.count == 2 {
      guard let column = Int(parts[1]), column > 0 else { return nil }
      self.column = column
    }
  }
}
