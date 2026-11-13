import Foundation

/// Where dictated words land in the draft: at the caret it had when listening
/// began, spaced from the text on either side.
struct DictationDraft: Equatable {
  let prefix: String
  let suffix: String

  /// `caret` is a UTF-16 offset, as the editors report it.
  init(text: String, caret: Int) {
    let utf16 = text.utf16
    var split = utf16.index(utf16.startIndex, offsetBy: min(max(caret, 0), utf16.count))
    // A caret inside a character (an emoji's surrogates) rounds down to its start.
    while split > text.startIndex, split.samePosition(in: text) == nil {
      split = utf16.index(before: split)
    }
    prefix = String(text[..<split])
    suffix = String(text[split...])
  }

  var original: String { prefix + suffix }

  /// The draft with `transcript` spliced in, and the caret just after it.
  func merged(_ transcript: String) -> (text: String, caret: Int) {
    let words = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !words.isEmpty else { return (original, prefix.utf16.count) }
    let lead = prefix.last.map { $0.isWhitespace ? "" : " " } ?? ""
    let trail = suffix.first.map { $0.isWhitespace ? "" : " " } ?? ""
    let head = prefix + lead + words
    return (head + trail + suffix, head.utf16.count)
  }
}
