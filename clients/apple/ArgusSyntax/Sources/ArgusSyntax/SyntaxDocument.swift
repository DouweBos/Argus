import Foundation

/// An incrementally parsed document, isolated off the main actor. Feed it every edit; ask it
/// for the runs of the visible range.
public actor SyntaxDocument {
  public let language: SyntaxLanguage
  private let engine: SyntaxEngine

  /// Nil when the language's grammar or query failed to load: show "Plain Text".
  public init?(language: SyntaxLanguage, text: String) {
    guard let engine = SyntaxEngine(grammar: .language(language), text: text) else { return nil }
    self.language = language
    self.engine = engine
  }

  /// `range` is in UTF-16 units of the text *before* the edit; `fullText` is the text after it,
  /// used to resync if the edit doesn't line up.
  public func edit(range: NSRange, newText: String, fullText: String) {
    if !engine.edit(range: range, newText: newText) || engine.buffer.count != fullText.utf16.count {
      engine.replaceAll(fullText)
    }
  }

  public func replaceAll(_ text: String) {
    engine.replaceAll(text)
  }

  /// Sorted, non-overlapping runs intersecting `range`; the innermost, last-declared capture wins.
  public func highlights(in range: NSRange) -> [SyntaxRun] {
    engine.highlights(in: range)
  }

  /// Foldable regions of the whole document, in document order.
  public func folds() -> [SyntaxFold] {
    engine.folds()
  }

  /// Parses now rather than on the next `highlights(in:)`, e.g. right after opening a file.
  public func prepare() {
    engine.parseIfNeeded()
  }
}

/// One-shot highlighting for read-only views and chat code blocks.
public enum SyntaxHighlighter {
  public static func highlight(_ text: String, language: SyntaxLanguage) -> [SyntaxRun] {
    guard let engine = SyntaxEngine(grammar: .language(language), text: text) else { return [] }
    return engine.highlights(in: NSRange(location: 0, length: engine.buffer.count))
  }

  public static func folds(_ text: String, language: SyntaxLanguage) -> [SyntaxFold] {
    SyntaxEngine(grammar: .language(language), text: text)?.folds() ?? []
  }

  /// Whether the bundled grammar and its queries load. False means "Plain Text".
  public static func isAvailable(_ language: SyntaxLanguage) -> Bool {
    GrammarRegistry.assets(for: .language(language)) != nil
  }
}
