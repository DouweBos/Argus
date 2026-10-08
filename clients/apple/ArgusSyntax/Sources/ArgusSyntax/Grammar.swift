import Foundation
import Synchronization
import SwiftTreeSitter
import TreeSitterBash
import TreeSitterCSS
import TreeSitterGo
import TreeSitterHTML
import TreeSitterJSON
import TreeSitterJava
import TreeSitterJavaScript
import TreeSitterKotlin
import TreeSitterMarkdown
import TreeSitterMarkdownInline
import TreeSitterObjc
import TreeSitterPython
import TreeSitterRuby
import TreeSitterRust
import TreeSitterSwift
import TreeSitterTSX
import TreeSitterTypeScript
import TreeSitterYAML

/// A parser + queries pair. One per `SyntaxLanguage`, plus Markdown's inline grammar,
/// which only ever appears as an injection.
enum Grammar: Hashable, Sendable {
  case language(SyntaxLanguage)
  case markdownInline

  /// Resolves an injection's language name (`markdown_inline`, or a fence info string).
  init?(injectionName: String) {
    if injectionName == "markdown_inline" {
      self = .markdownInline
    } else if let language = SyntaxLanguage(languageName: injectionName) {
      self = .language(language)
    } else {
      return nil
    }
  }

  var queryDirectory: String {
    switch self {
    case .language(let language): language.rawValue
    case .markdownInline: "markdown_inline"
    }
  }

  var tsLanguage: Language {
    let pointer: OpaquePointer =
      switch self {
      case .markdownInline: tree_sitter_markdown_inline()
      case .language(let language):
        switch language {
        case .swift: tree_sitter_swift()
        case .typescript: tree_sitter_typescript()
        case .tsx: tree_sitter_tsx()
        case .javascript: tree_sitter_javascript()
        case .json: tree_sitter_json()
        case .markdown: tree_sitter_markdown()
        case .kotlin: tree_sitter_kotlin()
        case .java: tree_sitter_java()
        case .objc: tree_sitter_objc()
        case .yaml: tree_sitter_yaml()
        case .bash: tree_sitter_bash()
        case .css: tree_sitter_css()
        case .html: tree_sitter_html()
        case .python: tree_sitter_python()
        case .ruby: tree_sitter_ruby()
        case .go: tree_sitter_go()
        case .rust: tree_sitter_rust()
        }
      }
    return Language(language: pointer)
  }

  static var all: [Grammar] { SyntaxLanguage.allCases.map(Grammar.language) + [.markdownInline] }
}

/// What it takes to highlight one grammar: compiled queries plus each highlight capture's style.
struct GrammarAssets: Sendable {
  /// Paint instruction per capture index: a `SyntaxCapture` ordinal, `clear`, or nil (ignore).
  static let clear: Int8 = -1

  let language: Language
  let highlights: Query
  let injections: Query?
  let styles: [Int8?]

  init(grammar: Grammar) throws {
    let language = grammar.tsLanguage
    self.language = language
    let highlights = try Query(language: language, data: Self.queryData(grammar, "highlights"))
    if let data = try Self.optionalQueryData(grammar, "injections") {
      injections = try Query(language: language, data: data)
    } else {
      injections = nil
    }
    self.highlights = highlights
    styles = (0..<highlights.captureCount).map { index in
      guard let name = highlights.captureName(for: index) else { return nil }
      if name == "none" { return GrammarAssets.clear }
      return SyntaxCapture.resolve(name).flatMap { capture in
        SyntaxCapture.allCases.firstIndex(of: capture).map { Int8($0) }
      }
    }
  }

  static func queryURL(_ grammar: Grammar, _ name: String) -> URL? {
    Bundle.module.url(
      forResource: name, withExtension: "scm", subdirectory: "queries/\(grammar.queryDirectory)")
  }

  private static func queryData(_ grammar: Grammar, _ name: String) throws -> Data {
    guard let data = try optionalQueryData(grammar, name) else {
      throw GrammarError.missingQuery("\(grammar.queryDirectory)/\(name).scm")
    }
    return data
  }

  private static func optionalQueryData(_ grammar: Grammar, _ name: String) throws -> Data? {
    guard let url = queryURL(grammar, name) else { return nil }
    return try Data(contentsOf: url)
  }
}

enum GrammarError: Error {
  case missingQuery(String)
}

/// Compiles each grammar's queries once per process.
enum GrammarRegistry {
  private static let cache = Mutex<[Grammar: Result<GrammarAssets, any Error>]>([:])

  static func assets(for grammar: Grammar) -> GrammarAssets? {
    try? result(for: grammar).get()
  }

  static func result(for grammar: Grammar) -> Result<GrammarAssets, any Error> {
    if let cached = cache.withLock({ $0[grammar] }) { return cached }
    let result = Result { try GrammarAssets(grammar: grammar) }
    cache.withLock { $0[grammar] = result }
    return result
  }
}
