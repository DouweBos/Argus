import Foundation

/// The whitespace fixes applied on save, as minimal edits so undo and the caret survive them.
enum SaveTransform {
  struct Edit: Equatable {
    var range: NSRange
    var text: String
  }

  static func edits(for text: NSString, configuration: EditorConfiguration) -> [Edit] {
    var edits: [Edit] = []
    let length = text.length
    if configuration.trimTrailingWhitespaceOnSave {
      var lineStart = 0
      while lineStart < length {
        var end = 0
        var contentsEnd = 0
        text.getLineStart(nil, end: &end, contentsEnd: &contentsEnd, for: NSRange(location: lineStart, length: 0))
        var trimmedEnd = contentsEnd
        while trimmedEnd > lineStart, isTrailingSpace(text.character(at: trimmedEnd - 1)) { trimmedEnd -= 1 }
        if trimmedEnd < contentsEnd {
          edits.append(Edit(range: NSRange(location: trimmedEnd, length: contentsEnd - trimmedEnd), text: ""))
        }
        lineStart = end
      }
    }
    if configuration.insertFinalNewline, length > 0 {
      let last = text.character(at: length - 1)
      if last != 0x0A && last != 0x0D {
        edits.append(Edit(range: NSRange(location: length, length: 0), text: lineEnding(of: text)))
      }
    }
    return edits
  }

  static func apply(_ edits: [Edit], to text: String) -> String {
    let result = NSMutableString(string: text)
    for edit in edits.sorted(by: { $0.range.location > $1.range.location }) {
      result.replaceCharacters(in: edit.range, with: edit.text)
    }
    return result as String
  }

  /// The document's dominant line ending, from its first break.
  static func lineEnding(of text: NSString) -> String {
    let newline = text.rangeOfCharacter(from: .newlines)
    guard newline.location != NSNotFound else { return "\n" }
    if text.character(at: newline.location) == 0x0D {
      let next = newline.location + 1
      return next < text.length && text.character(at: next) == 0x0A ? "\r\n" : "\r"
    }
    return "\n"
  }

  private static func isTrailingSpace(_ c: unichar) -> Bool {
    c == 0x20 || c == 0x09
  }
}
