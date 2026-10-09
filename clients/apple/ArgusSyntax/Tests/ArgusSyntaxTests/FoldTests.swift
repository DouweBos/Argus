import Foundation
import Testing

@testable import ArgusSyntax

@Suite struct FoldTests {
  /// What each fold leaves on screen: the text with every hidden range replaced by `…`, one per fold.
  private func collapsed(_ text: String, _ language: SyntaxLanguage) -> [String] {
    let ns = text as NSString
    return SyntaxHighlighter.folds(text, language: language).map { fold in
      ns.replacingCharacters(in: fold.hidden, with: "…")
        .components(separatedBy: "\n").first { $0.contains("…") } ?? ""
    }
  }

  @Test func everyFoldsQueryCompiles() {
    let withQueries = SyntaxLanguage.allCases.filter { GrammarAssets.queryURL(.language($0), "folds") != nil }
    #expect(withQueries.count >= 12)
    for language in withQueries {
      #expect(GrammarRegistry.assets(for: .language(language))?.folds != nil, "\(language) folds.scm")
    }
  }

  @Test func jsonObjectsAndArrays() {
    let text = "{\n  \"a\": {\n    \"b\": 1\n  },\n  \"c\": [\n    1\n  ]\n}\n"
    #expect(collapsed(text, .json) == ["{…}", "  \"a\": {…},", "  \"c\": […]"])
  }

  @Test func swiftTypesAndFunctions() {
    let text = "struct A {\n  func f() {\n    print(1)\n  }\n}\n/* one\n two */\n"
    #expect(collapsed(text, .swift) == ["struct A {…}", "  func f() {…}", "/* one…"])
  }

  @Test func tsxComponentsAndElements() {
    let text = "export function App() {\n  return (\n    <div>\n      <p>hi</p>\n    </div>\n  );\n}\n"
    #expect(collapsed(text, .tsx) == ["export function App() {…}", "  return (…);", "    <div>…</div>"])
  }

  @Test func markdownSections() {
    let text = "# A\n\nintro\n\n## B\n\nbody\n\n# C\n\nend\n"
    #expect(collapsed(text, .markdown) == ["# A…", "## B…", "# C…"])
  }

  @Test func rubyKeepsEndVisible() {
    let text = "def f\n  1\nend\n"
    #expect(collapsed(text, .ruby) == ["def f…end"])
  }

  @Test func singleLineBracketsDoNotFold() {
    #expect(SyntaxHighlighter.folds("let a = [1, 2]\n", language: .swift).isEmpty)
  }
}
