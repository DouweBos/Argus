import Foundation
import Testing

@testable import ArgusSyntax

@Suite struct QueryTests {
  @Test(arguments: Grammar.all)
  func queriesCompile(grammar: Grammar) throws {
    let assets = try GrammarRegistry.result(for: grammar).get()
    #expect(assets.highlights.patternCount > 0)
  }

  /// Every capture a query paints must be in the Argus vocabulary; a typo would silently
  /// leave tokens plain.
  @Test(arguments: Grammar.all)
  func capturesUseVocabulary(grammar: Grammar) throws {
    let query = try GrammarRegistry.result(for: grammar).get().highlights
    for index in 0..<query.captureCount {
      let name = try #require(query.captureName(for: index))
      if name.hasPrefix("_") || name == "none" { continue }
      #expect(SyntaxCapture(rawValue: name) != nil, "\(grammar.queryDirectory): @\(name)")
    }
  }

  @Test func captureFallbackStripsSuffixes() {
    #expect(SyntaxCapture.resolve("keyword.return") == .keyword)
    #expect(SyntaxCapture.resolve("function.method.builtin") == .function)
    #expect(SyntaxCapture.resolve("label") == nil)
  }
}

@Suite struct GoldenTests {
  static let expectations: [SyntaxLanguage: [(String, SyntaxCapture)]] = [
    .swift: [
      ("import", .keyword), ("/// A greeting.", .comment), ("Greeter", .type), ("func |greet", .function),
      ("3", .number), ("\\n", .escape), ("\"Hello, ", .string), ("// repeat", .comment),
    ],
    .typescript: [
      ("interface", .keyword), ("Options", .type), ("\"node:fs/promises\"", .string),
      ("load", .function), ("retries", .property), ("// Load the config.", .comment),
    ],
    .tsx: [("div", .tag), ("className", .attribute), ("\"card\"", .string), ("Props", .type)],
    .javascript: [
      ("const", .keyword), ("reduce", .function), ("greet", .function), ("// Sum values.", .comment),
      ("ab+c", .regex), ("0", .number),
    ],
    .json: [("\"name\"", .string), ("3", .number), ("true", .constant), ("null", .constant)],
    .markdown: [
      ("Title", .heading), ("emphasis", .emphasis), ("strong", .strong), ("link", .link),
      ("https://example.com", .link), ("code", .code), ("let", .keyword), ("1", .number),
    ],
    .kotlin: [
      ("fun", .keyword), ("main", .function), ("42", .number), ("\"Hello ", .string),
      ("// Entry point.", .comment), ("String", .type),
    ],
    .java: [
      ("public", .keyword), ("Main", .type), ("main", .function), ("42", .number),
      ("\"Hello\"", .string), ("// Entry point.", .comment),
    ],
    .objc: [
      ("@interface", .keyword), ("Greeter", .type), ("NSString", .type), ("\"Hello\"", .string),
      ("// A greeter.", .comment),
    ],
    .yaml: [("# Config", .comment), ("name", .property), ("3", .number), ("true", .constant)],
    .bash: [("if", .keyword), ("echo", .function), ("\"hello\"", .string), ("# Build it.", .comment)],
    .css: [("/* Card */", .comment), ("color", .property), ("4", .number), ("> |a", .tag)],
    .html: [
      ("div", .tag), ("class", .attribute), ("<!-- page -->", .comment), ("const", .keyword),
      ("42", .number), ("margin", .property),
    ],
    .python: [
      ("import", .keyword), ("main", .function), ("\"hello\"", .string), ("Greeter", .type),
      ("# Entry point.", .comment),
    ],
    .ruby: [
      ("class", .keyword), ("Greeter", .type), ("def |greet", .function), (":done", .constant),
      ("\"Hello ", .string),
    ],
    .go: [
      ("package", .keyword), ("func |main", .function), ("42", .number), ("Println", .function),
      ("\"hello\"", .string),
    ],
    .rust: [
      ("fn", .keyword), ("main", .function), ("u32", .type), ("42", .number),
      ("\"hello {}\"", .string), ("println!", .function),
    ],
  ]

  @Test(arguments: SyntaxLanguage.allCases)
  func highlightsFixture(language: SyntaxLanguage) throws {
    let text = Fixtures.source(for: language)
    let runs = SyntaxHighlighter.highlight(text, language: language)
    #expect(SyntaxHighlighter.isAvailable(language))
    expectSortedAndDisjoint(runs)
    let expectations = try #require(Self.expectations[language])
    for (token, capture) in expectations {
      let parts = token.components(separatedBy: "|")
      let found = (text as NSString).range(of: parts.joined())
      try #require(found.location != NSNotFound, "\(token) not in fixture")
      let prefix = parts.count > 1 ? (parts[0] as NSString).length : 0
      let range = NSRange(location: found.location + prefix, length: found.length - prefix)
      let covering = runs.first { NSIntersectionRange($0.range, range) == range }
      #expect(covering?.capture == capture, "\(language): \(token) → \(String(describing: covering?.capture))")
    }
  }
}

func expectSortedAndDisjoint(_ runs: [SyntaxRun], sourceLocation: SourceLocation = #_sourceLocation) {
  for (previous, next) in zip(runs, runs.dropFirst()) {
    #expect(NSMaxRange(previous.range) <= next.range.location, sourceLocation: sourceLocation)
  }
}
